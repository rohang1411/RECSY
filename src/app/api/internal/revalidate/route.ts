/**
 * POST /api/internal/revalidate — Protected cache revalidation endpoint.
 *
 * Requirements (Plan 26 WP-07):
 * - Authenticated with HMAC-SHA256 signature using REVALIDATE_SECRET.
 * - Enforces timestamp freshness (within 5 minutes).
 * - Validates all tags against the allowed pattern whitelist.
 * - Rate-limited to 60 revalidations/min using PostgresRateLimitStore (fails open).
 * - Calls revalidateTag(tag, 'max') for stale-while-revalidate behavior.
 */
import { randomBytes } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { env } from '@/env';
import { verifyHmacSha256 } from '@/lib/hmac';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { isValidTag } from '@/services/cache/tags';
import { PostgresRateLimitStore } from '@/services/rate-limit/store';
import { invalidateAspectDefinitionsCache } from '@/services/recommender/aspect-definitions-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const revalidateBodySchema = z.object({
  tags: z.array(z.string().trim().min(1).max(256)).min(1).max(50),
  reason: z.string().trim().min(1).max(200),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/internal/revalidate' });

  // 1. Ensure revalidation secret is configured
  const secret = env.REVALIDATE_SECRET;
  if (!secret || secret.trim().length === 0) {
    log.error('REVALIDATE_SECRET is not configured');
    return NextResponse.json(
      { error: 'Revalidation endpoint is not configured' },
      { status: 500, headers: { 'X-Trace-Id': traceId } },
    );
  }

  // 2. Validate timestamp header (fresh within 5 minutes)
  const timestampHeader = request.headers.get('x-recsy-timestamp')?.trim();
  const signatureHeader = request.headers.get('x-recsy-signature')?.trim();

  if (!timestampHeader || !signatureHeader) {
    log.warn('Missing revalidation signature or timestamp headers');
    return NextResponse.json(
      { error: 'Missing x-recsy-timestamp or x-recsy-signature header' },
      { status: 401, headers: { 'X-Trace-Id': traceId } },
    );
  }

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    log.warn({ ts, now: Date.now() }, 'Revalidation timestamp stale or invalid');
    return NextResponse.json(
      { error: 'Timestamp expired or invalid' },
      { status: 401, headers: { 'X-Trace-Id': traceId } },
    );
  }

  // 3. Read body with size bound (max 64KB)
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read request body' }, { status: 400 });
  }

  if (rawBody.length > 65_536) {
    return NextResponse.json({ error: 'Request body exceeds 64KB limit' }, { status: 400 });
  }

  // 4. Constant-time HMAC signature verification
  const messageToVerify = `${timestampHeader}.${rawBody}`;
  const isValidSig = verifyHmacSha256(messageToVerify, signatureHeader, secret);
  if (!isValidSig) {
    log.warn('Invalid revalidation signature');
    return NextResponse.json(
      { error: 'Invalid HMAC signature' },
      { status: 401, headers: { 'X-Trace-Id': traceId } },
    );
  }

  // 5. Parse and validate JSON payload
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const parsed = revalidateBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Malformed revalidate payload', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { tags, reason } = parsed.data;

  // 6. Whitelist validate each tag
  for (const tag of tags) {
    if (!isValidTag(tag)) {
      log.warn({ tag }, 'Rejected tag not matching pattern whitelist');
      return NextResponse.json({ error: `Invalid tag format: ${tag}` }, { status: 400 });
    }
  }

  // 7. Rate limit (60/min global fixed key, fail-open)
  try {
    const db = getDb();
    const store = new PostgresRateLimitStore(db);
    const [rateResult] = await store.consume(
      [
        {
          key: 'revalidate:global',
          max: 60,
          windowMs: 60_000,
          subject: 'ip',
        },
      ],
      Date.now(),
    );
    if (rateResult && rateResult.limited) {
      log.warn({ count: rateResult.count }, 'Revalidation rate limit exceeded');
      return NextResponse.json(
        { error: 'Revalidation rate limit exceeded' },
        {
          status: 429,
          headers: {
            'Retry-After': '60',
            'X-Trace-Id': traceId,
          },
        },
      );
    }
  } catch (err) {
    log.warn({ err }, 'Revalidation rate limit store check failed, failing open');
  }

  // 8. Revalidate each tag with 'max' profile (stale-while-revalidate)
  for (const tag of tags) {
    revalidateTag(tag, 'max');
    if (tag === 'aspect-definitions') {
      invalidateAspectDefinitionsCache();
    }
  }

  log.info({ tags, reason, count: tags.length }, 'Successfully revalidated cache tags');

  return NextResponse.json(
    { revalidated: tags },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
        'X-Trace-Id': traceId,
      },
    },
  );
}

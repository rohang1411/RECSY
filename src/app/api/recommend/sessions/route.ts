/**
 * /api/recommend/sessions — List and create conversational recommendation threads.
 *
 * GET: Lists active session summaries for the authenticated client.
 * POST: Initializes a new isolated recommendation thread.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ZodError, z } from 'zod';

import { CLIENT_ID_COOKIE } from '@/lib/constants';
import { env } from '@/env';
import { toAppError } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { summarizeErrorChainForLogs } from '@/lib/summarize-error';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { hashSessionIp } from '@/services/rate-limit/ip-hash';
import {
  createSession,
  getOrCreateClient,
  listSessionsForClient,
} from '@/services/recommender/session-manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clientCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    secure: env.NODE_ENV === 'production',
  };
}

const postSessionSchema = z.object({
  title: z.string().trim().max(100).optional(),
  primaryIntent: z.string().trim().max(50).optional(),
  regionCode: z.string().trim().max(10).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: NextRequest): Promise<Response> {
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: 'GET /api/recommend/sessions' });

  try {
    const db = getDb();
    const cookieToken = request.cookies.get(CLIENT_ID_COOKIE)?.value ?? null;
    const ip = getRequestClientIp(request);
    const { client, isNew } = await getOrCreateClient(db, {
      clientToken: cookieToken,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : 30;
    const includeArchived = url.searchParams.get('includeArchived') === 'true';

    const sessions = await listSessionsForClient(db, client.id, {
      limit: Number.isNaN(limit) ? 30 : limit,
      includeArchived,
    });

    const res = NextResponse.json(
      { sessions },
      { status: 200, headers: { 'X-Trace-Id': traceId } },
    );

    if (isNew) {
      res.cookies.set(CLIENT_ID_COOKIE, client.clientToken, clientCookieOptions());
    }

    return res;
  } catch (err) {
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'GET /api/recommend/sessions failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  const traceId = randomBytes(16).toString('hex');
  const log = requestLogger({ traceId, route: 'POST /api/recommend/sessions' });

  try {
    const db = getDb();
    const cookieToken = request.cookies.get(CLIENT_ID_COOKIE)?.value ?? null;
    const ip = getRequestClientIp(request);
    const { client, isNew } = await getOrCreateClient(db, {
      clientToken: cookieToken,
      ipHash: hashSessionIp(ip),
      userAgent: request.headers.get('user-agent'),
    });

    const json: unknown = await request.json().catch(() => ({}));
    const body = postSessionSchema.parse(json);

    const regionCode = body.regionCode || request.cookies.get('recsy_region')?.value || 'US';

    const session = await createSession(db, client.id, {
      title: body.title,
      primaryIntent: body.primaryIntent,
      regionCode,
      metadata: body.metadata,
    });

    const res = NextResponse.json(
      {
        session: {
          id: session.id,
          title: session.title,
          primaryIntent: session.primaryIntent,
          isPinned: session.isPinned,
          status: session.status,
          metadata: session.metadata,
          createdAt: session.createdAt.toISOString(),
          updatedAt: session.updatedAt.toISOString(),
        },
      },
      { status: 201, headers: { 'X-Trace-Id': traceId } },
    );

    if (isNew) {
      res.cookies.set(CLIENT_ID_COOKIE, client.clientToken, clientCookieOptions());
    }

    return res;
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { code: 'VALIDATION', message: err.flatten() },
        { status: 400, headers: { 'X-Trace-Id': traceId } },
      );
    }
    const app = toAppError(err);
    log.warn(
      { err: app.message, code: app.code, detail: summarizeErrorChainForLogs(err) },
      'POST /api/recommend/sessions failed',
    );
    return NextResponse.json(
      { code: app.code, message: app.message },
      { status: app.status, headers: { 'X-Trace-Id': traceId } },
    );
  }
}

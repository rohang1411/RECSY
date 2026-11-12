import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/same-origin';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { getPerfFlags, isRecommendSessionsEnabled } from '@/services/perf/flags';
import { consumeSessionRateLimit } from '@/services/rate-limit';
import { claimGuestSessions } from '@/services/recommender/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const claimBodySchema = z
  .object({
    sessionIds: z.array(z.string().uuid()).max(20).optional(),
  })
  .optional();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/recommend/sessions/claim' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });

    const perf = await getPerfFlags(db);
    if (!isRecommendSessionsEnabled(perf, identity.userId)) {
      throw new AppError('NOT_FOUND', 'Not found', { status: 404 });
    }

    if (!identity.userId) {
      throw new AppError('UNAUTHORIZED', 'Sign-in required to claim sessions', { status: 401 });
    }

    await consumeSessionRateLimit('sessions:mutate', identity.userId, db);

    if (!identity.deviceId || identity.deviceId.startsWith('nocookie:')) {
      return NextResponse.json(
        { claimed: 0 },
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Trace-Id': traceId,
          },
        },
      );
    }

    let rawBody: unknown;
    try {
      const text = await request.text();
      rawBody = text.trim() ? JSON.parse(text) : undefined;
    } catch {
      throw new AppError('VALIDATION', 'Invalid JSON body', { status: 400 });
    }

    const parsed = claimBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Invalid claim request payload', { status: 400 });
    }

    const result = await claimGuestSessions(
      db,
      identity.userId,
      identity.deviceId,
      parsed.data?.sessionIds,
    );

    return NextResponse.json(
      { claimed: result.claimed },
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Trace-Id': traceId,
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'claim sessions request rejected');
      return NextResponse.json(
        {
          code: err.code,
          message: publicErrorMessage(err),
          traceId,
        },
        {
          status: err.status,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Trace-Id': traceId,
          },
        },
      );
    }

    log.error({ err }, 'failed to claim guest sessions');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Internal server error',
        traceId,
      },
      {
        status: 500,
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Trace-Id': traceId,
        },
      },
    );
  }
}

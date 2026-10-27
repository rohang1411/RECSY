import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { getRequestClientIp } from '@/lib/request-ip';
import { assertSameOrigin } from '@/lib/same-origin';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { getPerfFlags, isRecommendSessionsEnabled } from '@/services/perf/flags';
import { consumeSessionRateLimit, hashClientIp } from '@/services/rate-limit';
import { ownerFromIdentity, restoreSession } from '@/services/recommender/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const idSchema = z.string().uuid();

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/recommend/sessions/:id/restore' });

  try {
    assertSameOrigin(request);

    const { id } = await context.params;
    const idValidation = idSchema.safeParse(id);
    if (!idValidation.success) {
      throw new AppError('NOT_FOUND', 'Session not found', { status: 404 });
    }

    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });

    const perf = await getPerfFlags(db);
    if (!isRecommendSessionsEnabled(perf, identity.userId)) {
      throw new AppError('NOT_FOUND', 'Not found', { status: 404 });
    }

    const clientIp = getRequestClientIp(request);
    const subject =
      identity.userId ??
      (identity.deviceId && !identity.deviceId.startsWith('nocookie:')
        ? identity.deviceId
        : hashClientIp(clientIp));

    await consumeSessionRateLimit('sessions:mutate', subject, db);

    const owner = ownerFromIdentity(identity);
    const { restored } = await restoreSession(db, id, owner);

    if (!restored) {
      throw new AppError('NOT_FOUND', 'Session not found or cannot be restored', { status: 404 });
    }

    return NextResponse.json(
      { success: true, id },
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
      log.warn({ code: err.code, status: err.status }, 'restore session request rejected');
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

    log.error({ err }, 'failed to restore session');
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

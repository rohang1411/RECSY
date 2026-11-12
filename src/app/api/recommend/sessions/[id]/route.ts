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
import {
  getSessionDetail,
  ownerFromIdentity,
  softDeleteSession,
  updateSession,
} from '@/services/recommender/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

const idSchema = z.string().uuid();

const getDetailQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().min(0).optional(),
});

const patchBodySchema = z
  .object({
    title: z.string().optional(),
    isPinned: z.boolean().optional(),
    status: z.enum(['active', 'archived']).optional(),
  })
  .refine(
    (data) => data.title !== undefined || data.isPinned !== undefined || data.status !== undefined,
    {
      message: 'At least one field must be provided',
    },
  );

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/recommend/sessions/:id' });

  try {
    const { id } = await context.params;
    const idValidation = idSchema.safeParse(id);
    if (!idValidation.success) {
      // Plan 27 Section 9.3: Malformed id maps to 404 to avoid probing
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

    await consumeSessionRateLimit('sessions:detail', subject, db);

    const url = new URL(request.url);
    const parsedQuery = getDetailQuerySchema.safeParse({
      limit: url.searchParams.get('limit') ?? undefined,
      before: url.searchParams.get('before') ?? undefined,
    });

    if (!parsedQuery.success) {
      throw new AppError('VALIDATION', 'Invalid query parameters', { status: 400 });
    }

    const owner = ownerFromIdentity(identity);
    const session = await getSessionDetail(db, id, owner, {
      limit: parsedQuery.data.limit,
      beforeTurnIndex: parsedQuery.data.before,
    });

    if (!session) {
      throw new AppError('NOT_FOUND', 'Session not found', { status: 404 });
    }

    return NextResponse.json(
      { session },
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
      log.warn({ code: err.code, status: err.status }, 'session detail request rejected');
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

    log.error({ err }, 'failed to get session detail');
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

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'PATCH /api/recommend/sessions/:id' });

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

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new AppError('VALIDATION', 'Invalid JSON body', { status: 400 });
    }

    const parsed = patchBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new AppError(
        'VALIDATION',
        parsed.error.issues[0]?.message ?? 'Invalid update payload',
        {
          status: 400,
        },
      );
    }

    const owner = ownerFromIdentity(identity);
    const result = await updateSession(db, id, owner, parsed.data);

    if (result.error === 'PIN_LIMIT_EXCEEDED') {
      throw new AppError('PIN_LIMIT_EXCEEDED', 'Maximum of 50 pinned sessions allowed', {
        status: 409,
      });
    }

    if (!result.session) {
      throw new AppError('NOT_FOUND', 'Session not found', { status: 404 });
    }

    return NextResponse.json(
      { session: result.session },
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
      log.warn({ code: err.code, status: err.status }, 'session update request rejected');
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

    log.error({ err }, 'failed to update session');
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

export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'DELETE /api/recommend/sessions/:id' });

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
    const { deleted } = await softDeleteSession(db, id, owner);

    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Session not found', { status: 404 });
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
      log.warn({ code: err.code, status: err.status }, 'delete session request rejected');
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

    log.error({ err }, 'failed to delete session');
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

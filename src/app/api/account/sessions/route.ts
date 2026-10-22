/**
 * GET /api/account/sessions — lists cross-device recommendation sessions for authenticated user.
 * DELETE /api/account/sessions — deletes a single session owned by authenticated user.
 *
 * Normative reference: Plan 25 Section 11.6.1, 15.2, WP-18.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/same-origin';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { requireUser } from '@/services/auth/profile';
import {
  deleteUserSession,
  getUserSessionDetail,
  listUserSessions,
} from '@/services/account/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  id: z.string().uuid().optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/account/sessions' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await requireUser(request, { db });
    const userId = identity.userId!;

    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      id: url.searchParams.get('id') ?? undefined,
    });

    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Invalid query parameters', { status: 400 });
    }

    if (parsed.data.id) {
      const detail = await getUserSessionDetail(db, userId, parsed.data.id);
      if (!detail) {
        throw new AppError('NOT_FOUND', 'Session not found', { status: 404 });
      }
      return NextResponse.json(
        { session: detail },
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, no-store',
            'X-Trace-Id': traceId,
          },
        },
      );
    }

    const result = await listUserSessions(db, userId, {
      cursor: parsed.data.cursor,
      limit: parsed.data.limit,
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Trace-Id': traceId,
      },
    });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'account sessions request rejected');
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

    log.error({ err }, 'failed to list account sessions');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to list account sessions',
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

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'DELETE /api/account/sessions' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await requireUser(request, { db });
    const userId = identity.userId!;

    const url = new URL(request.url);
    const id = url.searchParams.get('id');
    if (!id) {
      throw new AppError('VALIDATION', 'Missing session id', { status: 400 });
    }

    const { deleted } = await deleteUserSession(db, userId, id);
    if (!deleted) {
      throw new AppError('NOT_FOUND', 'Session not found or not owned', { status: 404 });
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
      log.warn({ code: err.code, status: err.status }, 'delete account session rejected');
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

    log.error({ err }, 'failed to delete account session');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to delete account session',
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

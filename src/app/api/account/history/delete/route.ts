/**
 * POST /api/account/history/delete — wipes conversational history and queries.
 *
 * Normative reference: Plan 25 Section 10.5, 15.2.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/same-origin';
import { readRequestJson } from '@/lib/request-json';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { requireUser } from '@/services/auth/profile';
import { deleteUserHistory } from '@/services/account/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const historyDeleteSchema = z.object({
  scope: z.literal('all'),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/account/history/delete' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await requireUser(request, { db });
    const userId = identity.userId!;

    const body = await readRequestJson(request, 4096);
    const parsed = historyDeleteSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Scope must be "all"', { status: 400 });
    }

    const result = await deleteUserHistory(db, userId);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Trace-Id': traceId,
      },
    });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'history delete rejected');
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

    log.error({ err }, 'failed to delete history');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to delete history',
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

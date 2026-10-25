/**
 * POST /api/account/delete/cancel — cancels a pending account deletion.
 *
 * Normative reference: Plan 25 Section 10.5, 15.2.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { isAppError, publicErrorMessage } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/same-origin';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { getUserProfile, requireUser } from '@/services/auth/profile';
import { cancelDeletion } from '@/services/account/deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/account/delete/cancel' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    // Plan 26 WP-02: Deletion cancellation keeps authoritative getUser() server round trip to verify active credentials.
    const identity = await requireUser(request, { db });
    const userId = identity.userId!;

    const profile = await getUserProfile(db, userId);
    const result = await cancelDeletion(db, userId, profile?.email ?? '');

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Trace-Id': traceId,
      },
    });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'cancel deletion rejected');
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

    log.error({ err }, 'failed to cancel account deletion');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to cancel account deletion',
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

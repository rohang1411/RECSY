/**
 * POST /api/account/delete — schedules account deletion with a 30-day cooling period.
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
import { getUserProfile, requireUser } from '@/services/auth/profile';
import { requestDeletion } from '@/services/account/deletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

const deleteBodySchema = z.object({
  confirm: z.literal('DELETE'),
  otp: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/account/delete' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    // Plan 26 WP-02: Account deletion keeps authoritative getUser() server round trip to prevent deleted/revoked sessions from deleting account.
    const identity = await requireUser(request, { db });
    const userId = identity.userId!;

    const body = await readRequestJson(request, 4096);
    const parsed = deleteBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError('VALIDATION', 'Typed confirmation "DELETE" is required', {
        status: 400,
      });
    }

    const profile = await getUserProfile(db, userId);
    const origin = request.nextUrl.origin;
    const cancelUrl = `${origin}/account`;

    const result = await requestDeletion(db, userId, profile?.email ?? '', cancelUrl);

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'Cache-Control': 'private, no-store',
        'X-Trace-Id': traceId,
      },
    });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'deletion request rejected');
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

    log.error({ err }, 'failed to request account deletion');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to request account deletion',
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

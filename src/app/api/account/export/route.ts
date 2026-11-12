/**
 * POST /api/account/export — GDPR/CCPA user data export.
 *
 * Normative reference: Plan 25 Section 10.5, 15.2.
 * Rate limited to 1 export per user per day.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { RateLimitError, isAppError, publicErrorMessage } from '@/lib/errors';
import { assertSameOrigin } from '@/lib/same-origin';
import { getDb } from '@/services/db/client';
import { rateLimits } from '@/services/db/schema';
import { requestLogger } from '@/services/logger';
import { requireUser } from '@/services/auth/profile';
import { exportUserData } from '@/services/account/export';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'POST /api/account/export' });

  try {
    assertSameOrigin(request);

    const db = getDb();
    const identity = await requireUser(request, { db });
    const userId = identity.userId!;

    // 1 export per 24 hours per user
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const key = `export:user:v1:${userId}`;

    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart: dayStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });

    if ((row?.count ?? 1) > 1) {
      throw new RateLimitError({
        route: 'POST /api/account/export',
        maxAllowed: 1,
        userId,
      });
    }

    const data = await exportUserData(db, userId);
    const dateStr = new Date().toISOString().slice(0, 10);

    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="recsy-export-${dateStr}.json"`,
        'Cache-Control': 'private, no-store',
        'X-Trace-Id': traceId,
      },
    });
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'export denied');
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

    log.error({ err }, 'failed to export user data');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to export user data',
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

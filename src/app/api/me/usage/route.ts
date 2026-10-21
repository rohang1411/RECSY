/**
 * GET /api/me/usage — user query usage history and daily rollups.
 *
 * Normative reference: Plan 25 Section 15.2.
 * Strictly user-authenticated. Never includes query prompt text or sensitive tokens.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { isAppError, publicErrorMessage } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { requireUser } from '@/services/auth/profile';
import { consumeUserRateLimit } from '@/services/metering/rate-limit-user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

type DailyUsageRow = {
  usage_date: string;
  charged: number | string;
  not_charged: number | string;
};

type RecentLeaseRow = {
  id: string;
  reserved_at: Date | string;
  route: string;
  status: string;
  settle_reason: string | null;
  charge_source: string;
};

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/me/usage' });

  try {
    const db = getDb();
    const identity = await requireUser(request, { db });

    // Rate limiting: 60/min
    await consumeUserRateLimit(identity.userId, 'read', db);

    const { searchParams } = new URL(request.url);
    const rawDays = Number.parseInt(searchParams.get('days') ?? '30', 10);
    const days = Math.min(Math.max(Number.isFinite(rawDays) ? rawDays : 30, 1), 90);

    const userId = identity.userId!;

    // 1. Daily aggregation for the requested window
    const dailyRows = await db.execute<DailyUsageRow>(sql`
      SELECT
        usage_date,
        COUNT(*) FILTER (WHERE status = 'committed')::int AS charged,
        COUNT(*) FILTER (WHERE status IN ('no_charge', 'refunded'))::int AS not_charged
      FROM query_leases
      WHERE user_id = ${userId}::uuid
        AND usage_date >= ((now() AT TIME ZONE 'UTC')::date - (${days}::int * INTERVAL '1 day'))::date
      GROUP BY usage_date
      ORDER BY usage_date ASC;
    `);

    // 2. Recent <= 25 leases (privacy-safe, no query prompt text)
    const leaseRows = await db.execute<RecentLeaseRow>(sql`
      SELECT
        id,
        reserved_at,
        route,
        status,
        settle_reason,
        charge_source
      FROM query_leases
      WHERE user_id = ${userId}::uuid
      ORDER BY reserved_at DESC
      LIMIT 25;
    `);

    const daysPayload = dailyRows.map((r) => ({
      date: String(r.usage_date),
      charged: Number(r.charged ?? 0),
      notCharged: Number(r.not_charged ?? 0),
    }));

    const leasesPayload = leaseRows.map((l) => ({
      ref: l.id,
      at:
        l.reserved_at instanceof Date
          ? l.reserved_at.toISOString()
          : new Date(l.reserved_at).toISOString(),
      route: l.route,
      outcome: l.status,
      reason: l.settle_reason ?? undefined,
      source: l.charge_source,
    }));

    return NextResponse.json(
      {
        days: daysPayload,
        leases: leasesPayload,
      },
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
      log.warn({ code: err.code, status: err.status }, 'usage read denied');
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

    log.error({ err }, 'failed to serve usage');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to retrieve usage data',
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

/**
 * GET /api/internal/billing/user — operator user lookup by email or user ID.
 * Returns comprehensive profile, wallet, leases, ledger, orders, and subscriptions.
 *
 * Normative reference: Plan 25 Section 13.5, WP-19.
 */
import { randomBytes } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';

import { AppError, isAppError, publicErrorMessage } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { requestLogger } from '@/services/logger';
import { isOperatorAuthorized } from '@/services/internal/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/internal/billing/user' });

  try {
    const authorized = await isOperatorAuthorized();
    if (!authorized) {
      throw new AppError('UNAUTHORIZED', 'Operator authorization required', { status: 401 });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('q')?.trim();
    if (!query) {
      throw new AppError('VALIDATION', 'Search query required (?q=)', { status: 400 });
    }

    const db = getDb();

    // 1. Find profile by UUID or email
    type ProfileRow = Record<string, unknown> & {
      id: string;
      email: string;
      display_name: string | null;
      status: string;
      billing_hold: boolean;
      created_at: string;
      last_seen_at: string;
    };

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);

    const profileRows = await db.execute<ProfileRow>(sql`
      SELECT
        id::text,
        email,
        display_name,
        status,
        billing_hold,
        created_at::text,
        last_seen_at::text
      FROM user_profiles
      WHERE ${isUuid ? sql`id = ${query}::uuid` : sql`email_normalized = LOWER(TRIM(${query}))`}
      LIMIT 1;
    `);

    const profile = profileRows[0];
    if (!profile) {
      throw new AppError('NOT_FOUND', 'User profile not found', { status: 404 });
    }

    const userId = profile.id;

    // 2. Fetch wallet balance
    const walletRows = await db.execute<{ balance: number }>(sql`
      SELECT balance FROM credit_wallets WHERE user_id = ${userId}::uuid LIMIT 1;
    `);
    const balance = walletRows[0]?.balance ?? 0;

    // 3. Fetch last 50 leases
    type LeaseRow = Record<string, unknown> & {
      id: string;
      status: string;
      charge_source: string;
      cost_micros: number;
      latency_ms: number | null;
      trace_id: string;
      created_at: string;
    };

    const leaseRows = await db.execute<LeaseRow>(sql`
      SELECT
        id::text,
        status,
        charge_source,
        cost_micros,
        latency_ms,
        trace_id,
        created_at::text
      FROM query_leases
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 50;
    `);

    // 4. Fetch ledger entries
    type LedgerRow = Record<string, unknown> & {
      id: string;
      delta: number;
      kind: string;
      source: string;
      ref_id: string | null;
      created_at: string;
    };

    const ledgerRows = await db.execute<LedgerRow>(sql`
      SELECT
        id::text,
        delta,
        kind,
        source,
        ref_id,
        created_at::text
      FROM credit_ledger
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 50;
    `);

    // 5. Fetch orders
    type OrderRow = Record<string, unknown> & {
      id: string;
      provider: string;
      product_code: string;
      amount_cents: number;
      status: string;
      created_at: string;
    };

    const orderRows = await db.execute<OrderRow>(sql`
      SELECT
        id::text,
        provider,
        product_code,
        amount_cents,
        status,
        created_at::text
      FROM billing_orders
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 20;
    `);

    // 6. Fetch subscriptions
    type SubRow = Record<string, unknown> & {
      id: string;
      provider: string;
      plan_code: string;
      status: string;
      current_period_end: string;
    };

    const subRows = await db.execute<SubRow>(sql`
      SELECT
        id::text,
        provider,
        plan_code,
        status,
        current_period_end::text
      FROM subscriptions
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 10;
    `);

    return NextResponse.json(
      {
        user: {
          profile: {
            id: profile.id,
            email: profile.email,
            displayName: profile.display_name,
            status: profile.status,
            billingHold: profile.billing_hold,
            createdAt: profile.created_at,
            lastSeenAt: profile.last_seen_at,
          },
          balance,
          leases: leaseRows,
          ledger: ledgerRows,
          orders: orderRows,
          subscriptions: subRows,
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, private',
          'X-Trace-Id': traceId,
        },
      },
    );
  } catch (err) {
    if (isAppError(err)) {
      log.warn({ code: err.code, status: err.status }, 'operator user lookup rejected');
      return NextResponse.json(
        { code: err.code, message: publicErrorMessage(err) },
        { status: err.status, headers: { 'X-Trace-Id': traceId } },
      );
    }
    log.error({ err }, 'failed to lookup user');
    return NextResponse.json(
      { code: 'INTERNAL', message: 'Failed to lookup user' },
      { status: 500, headers: { 'X-Trace-Id': traceId } },
    );
  }
}

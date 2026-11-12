/**
 * GET /api/me/billing — user billing status, active subscription, credit wallet, and ledger history.
 *
 * Normative reference: Plan 25 Section 15.2.
 * Strictly user-authenticated.
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

type SubscriptionRow = {
  plan_code: string;
  status: string;
  included_queries: number;
  used: number;
  current_period_end: Date | string;
  cancel_at_period_end: boolean;
  entitled_until: Date | string;
};

type OrderRow = {
  id: string;
  product_code: string;
  amount_minor: number;
  currency: string;
  status: string;
  created_at: Date | string;
};

type LedgerRow = {
  id: string;
  created_at: Date | string;
  delta: number;
  balance_after: number;
  kind: string;
  metadata: Record<string, unknown> | null;
};

function humanizeLedgerKind(kind: string, metadata: Record<string, unknown> | null): string {
  if (typeof metadata?.description === 'string' && metadata.description.trim()) {
    return metadata.description.trim();
  }
  switch (kind) {
    case 'purchase':
      return 'Credit pack purchase';
    case 'usage':
      return 'Query usage charge';
    case 'grant':
      return 'Promotional credit grant';
    case 'reversal':
      return 'Credit adjustment / refund';
    case 'expire':
      return 'Credit expiration';
    default:
      return 'Balance adjustment';
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const traceId = request.headers.get('x-trace-id')?.trim() || generateTraceId();
  const log = requestLogger({ traceId, route: 'GET /api/me/billing' });

  try {
    const db = getDb();
    // Plan 26 WP-02: Financial ledger access keeps authoritative getUser() server round trip.
    const identity = await requireUser(request, { db });

    // Rate limiting: 60/min
    await consumeUserRateLimit(identity.userId, 'read', db);

    const userId = identity.userId!;
    const { searchParams } = new URL(request.url);
    const cursor = searchParams.get('cursor')?.trim() || null;

    // 1. Credit wallet balance
    const walletRows = await db.execute<{ balance: number }>(sql`
      SELECT balance
        FROM credit_wallets
       WHERE user_id = ${userId}::uuid
       LIMIT 1;
    `);
    const credits = walletRows[0]?.balance ?? 0;

    // 2. Best active subscription
    const subRows = await db.execute<SubscriptionRow>(sql`
      SELECT
        s.plan_code,
        s.status,
        s.included_queries,
        COALESCE(su.used, 0)::int AS used,
        s.current_period_end,
        s.cancel_at_period_end,
        s.entitled_until
      FROM subscriptions s
      LEFT JOIN subscription_usage su
        ON su.subscription_id = s.id AND su.period_start = s.current_period_start
      WHERE s.user_id = ${userId}::uuid
        AND s.entitled_until > now()
      ORDER BY s.entitled_until DESC
      LIMIT 1;
    `);

    let subscription: {
      planCode: string;
      status: string;
      includedQueries: number;
      usedThisPeriod: number;
      periodEnd: string;
      cancelAtPeriodEnd: boolean;
      graceUntil: string | null;
    } | null = null;

    if (subRows[0]) {
      const s = subRows[0];
      const periodEndIso =
        s.current_period_end instanceof Date
          ? s.current_period_end.toISOString()
          : new Date(s.current_period_end).toISOString();

      subscription = {
        planCode: s.plan_code,
        status: s.status,
        includedQueries: Number(s.included_queries),
        usedThisPeriod: Number(s.used),
        periodEnd: periodEndIso,
        cancelAtPeriodEnd: Boolean(s.cancel_at_period_end),
        graceUntil: null,
      };
    }

    // 3. Recent orders (limit 10)
    const orderRows = await db.execute<OrderRow>(sql`
      SELECT
        id,
        product_code,
        amount_minor,
        currency,
        status,
        created_at
      FROM billing_orders
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 10;
    `);

    const orders = orderRows.map((o) => ({
      id: o.id,
      productCode: o.product_code,
      amountMinor: Number(o.amount_minor),
      currency: o.currency,
      status: o.status,
      createdAt:
        o.created_at instanceof Date
          ? o.created_at.toISOString()
          : new Date(o.created_at).toISOString(),
    }));

    // 4. Ledger entries (paged, limit 20 + 1 for nextCursor check)
    const ledgerLimit = 20;
    const ledgerRows = await db.execute<LedgerRow>(
      cursor
        ? sql`
            SELECT id, created_at, delta, balance_after, kind, metadata
            FROM credit_ledger
            WHERE user_id = ${userId}::uuid
              AND created_at < ${cursor}::timestamptz
            ORDER BY created_at DESC
            LIMIT ${ledgerLimit + 1};
          `
        : sql`
            SELECT id, created_at, delta, balance_after, kind, metadata
            FROM credit_ledger
            WHERE user_id = ${userId}::uuid
            ORDER BY created_at DESC
            LIMIT ${ledgerLimit + 1};
          `,
    );

    const hasMore = ledgerRows.length > ledgerLimit;
    const pageRows = hasMore ? ledgerRows.slice(0, ledgerLimit) : ledgerRows;
    const lastRow = pageRows[pageRows.length - 1];
    const nextCursor =
      hasMore && lastRow
        ? lastRow.created_at instanceof Date
          ? lastRow.created_at.toISOString()
          : new Date(lastRow.created_at).toISOString()
        : null;

    const ledger = pageRows.map((l) => ({
      at:
        l.created_at instanceof Date
          ? l.created_at.toISOString()
          : new Date(l.created_at).toISOString(),
      delta: Number(l.delta),
      balanceAfter: Number(l.balance_after),
      kind: l.kind,
      description: humanizeLedgerKind(l.kind, l.metadata),
    }));

    return NextResponse.json(
      {
        credits,
        subscription,
        orders,
        ledger,
        nextCursor,
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
      log.warn({ code: err.code, status: err.status }, 'billing read denied');
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

    log.error({ err }, 'failed to serve billing');
    return NextResponse.json(
      {
        code: 'INTERNAL',
        message: 'Failed to retrieve billing data',
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

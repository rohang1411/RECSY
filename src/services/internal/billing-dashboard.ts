/**
 * Data loader for the /internal/billing operator dashboard.
 *
 * Normative reference: Plan 25 Section 13.5, WP-19.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { getDb } from '@/services/db/client';
import { checkLedgerDrift, type AlertResult } from '@/services/ops/alert-rules';

export interface BillingDashboardData {
  revenue: {
    todayCents: number;
    weekCents: number;
    monthCents: number;
    ordersCountToday: number;
  };
  subscriptions: {
    activeCount: number;
    estimatedMrrCents: number;
  };
  anomalies: {
    failedOrdersCount: number;
    disputedOrdersCount: number;
    webhookBacklogCount: number;
  };
  webhookEvents: {
    status: string;
    count: number;
  }[];
  recentOrders: {
    id: string;
    userId: string;
    provider: string;
    productCode: string;
    amountCents: number;
    status: string;
    createdAt: string;
  }[];
  ledgerDrift: AlertResult;
}

export async function loadBillingDashboardData(
  dbOverride?: AppQueryDb,
): Promise<BillingDashboardData> {
  const db = dbOverride ?? getDb();

  const [revRows, subRows, orderAnomalyRows, webhookRows, recentOrdersRows, ledgerDrift] =
    await Promise.all([
      // 1. Revenue today, 7d, 30d
      db.execute<{
        today_cents: number;
        week_cents: number;
        month_cents: number;
        today_orders: number;
      }>(sql`
        SELECT
          COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= (now() AT TIME ZONE 'UTC')::date AND status = 'fulfilled'), 0)::int AS today_cents,
          COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= (now() - interval '7 days') AND status = 'fulfilled'), 0)::int AS week_cents,
          COALESCE(SUM(amount_cents) FILTER (WHERE created_at >= (now() - interval '30 days') AND status = 'fulfilled'), 0)::int AS month_cents,
          COUNT(*) FILTER (WHERE created_at >= (now() AT TIME ZONE 'UTC')::date AND status = 'fulfilled')::int AS today_orders
        FROM billing_orders;
      `),

      // 2. Active subscriptions & MRR
      db.execute<{
        active_count: number;
        mrr_cents: number;
      }>(sql`
        SELECT
          COUNT(*)::int AS active_count,
          (COUNT(*) * 2000)::int AS mrr_cents -- $20/month per active pro subscription
        FROM subscriptions
        WHERE status = 'active';
      `),

      // 3. Order anomalies & webhook backlog
      db.execute<{
        failed_orders: number;
        disputed_orders: number;
        webhook_backlog: number;
      }>(sql`
        SELECT
          (SELECT COUNT(*)::int FROM billing_orders WHERE status = 'failed' AND created_at >= (now() - interval '7 days')) AS failed_orders,
          (SELECT COUNT(*)::int FROM billing_orders WHERE status = 'disputed') AS disputed_orders,
          (SELECT COUNT(*)::int FROM billing_events WHERE status IN ('received', 'failed', 'processing') AND created_at < (now() - interval '10 minutes')) AS webhook_backlog;
      `),

      // 4. Webhook status (24h)
      db.execute<{ status: string; count: number }>(sql`
        SELECT status, COUNT(*)::int AS count
        FROM billing_events
        WHERE created_at >= (now() - interval '24 hours')
        GROUP BY status
        ORDER BY count DESC;
      `),

      // 5. Recent orders
      db.execute<{
        id: string;
        user_id: string;
        provider: string;
        product_code: string;
        amount_cents: number;
        status: string;
        created_at: string;
      }>(sql`
        SELECT
          id::text,
          user_id::text,
          provider,
          product_code,
          amount_cents,
          status,
          created_at::text
        FROM billing_orders
        ORDER BY created_at DESC
        LIMIT 15;
      `),

      // 6. Ledger drift
      checkLedgerDrift(db),
    ]);

  const rev = revRows[0] ?? { today_cents: 0, week_cents: 0, month_cents: 0, today_orders: 0 };
  const sub = subRows[0] ?? { active_count: 0, mrr_cents: 0 };
  const anom = orderAnomalyRows[0] ?? {
    failed_orders: 0,
    disputed_orders: 0,
    webhook_backlog: 0,
  };

  return {
    revenue: {
      todayCents: rev.today_cents,
      weekCents: rev.week_cents,
      monthCents: rev.month_cents,
      ordersCountToday: rev.today_orders,
    },
    subscriptions: {
      activeCount: sub.active_count,
      estimatedMrrCents: sub.mrr_cents,
    },
    anomalies: {
      failedOrdersCount: anom.failed_orders,
      disputedOrdersCount: anom.disputed_orders,
      webhookBacklogCount: anom.webhook_backlog,
    },
    webhookEvents: webhookRows,
    recentOrders: recentOrdersRows.map((o) => ({
      id: o.id,
      userId: o.user_id,
      provider: o.provider,
      productCode: o.product_code,
      amountCents: o.amount_cents,
      status: o.status,
      createdAt: o.created_at,
    })),
    ledgerDrift,
  };
}

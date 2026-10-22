/**
 * Database-driven operations alert rules.
 *
 * Normative reference: Plan 25 Section 13.4, WP-19.
 * Evaluates operational conditions over SQL tables (leases, counters, ledger, billing_events)
 * without requiring an external metrics vendor.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';

export type AlertSeverity = 'page' | 'warn' | 'info';

export interface AlertResult {
  key: string;
  fired: boolean;
  severity: AlertSeverity;
  summary: string;
  details?: Record<string, unknown>;
}

/**
 * 1. lease_leak: any lease 'reserved' older than 5 minutes past expiry.
 */
export async function checkLeaseLeak(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM query_leases
    WHERE status = 'reserved'
      AND expires_at < (now() - interval '5 minutes');
  `);
  const count = rows[0]?.count ?? 0;
  return {
    key: 'lease_leak',
    fired: count > 0,
    severity: count >= 20 ? 'page' : 'warn',
    summary: count > 0 ? `${count} reserved leases stuck past expiration` : 'Zero stuck leases',
    details: { stuckCount: count },
  };
}

/**
 * 2. refund_ratio: refunded / (committed + refunded) > 5% over 30 min with >= 20 samples.
 */
export async function checkRefundRatio(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{
    committed: number;
    refunded: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE status = 'committed')::int AS committed,
      COUNT(*) FILTER (WHERE status = 'refunded')::int AS refunded
    FROM query_leases
    WHERE reserved_at >= (now() - interval '30 minutes')
      AND status IN ('committed', 'refunded');
  `);
  const committed = rows[0]?.committed ?? 0;
  const refunded = rows[0]?.refunded ?? 0;
  const total = committed + refunded;
  const ratio = total >= 20 ? refunded / total : 0;
  const fired = total >= 20 && ratio > 0.05;

  return {
    key: 'refund_ratio',
    fired,
    severity: 'page',
    summary: fired
      ? `High refund ratio: ${(ratio * 100).toFixed(1)}% (${refunded}/${total})`
      : `Refund ratio normal: ${(ratio * 100).toFixed(1)}% (${refunded}/${total})`,
    details: { committed, refunded, total, ratio },
  };
}

/**
 * 3. late_commit: share of late commits > 0.5% over 1 hour.
 */
export async function checkLateCommit(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{
    committed: number;
    late: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS committed,
      COUNT(*) FILTER (WHERE settled_at > expires_at)::int AS late
    FROM query_leases
    WHERE reserved_at >= (now() - interval '1 hour')
      AND status = 'committed';
  `);
  const committed = rows[0]?.committed ?? 0;
  const late = rows[0]?.late ?? 0;
  const ratio = committed >= 20 ? late / committed : 0;
  const fired = committed >= 20 && ratio > 0.005;

  return {
    key: 'late_commit',
    fired,
    severity: 'warn',
    summary: fired
      ? `High late commit ratio: ${(ratio * 100).toFixed(2)}% (${late}/${committed})`
      : `Late commit ratio normal: ${(ratio * 100).toFixed(2)}%`,
    details: { committed, late, ratio },
  };
}

/**
 * 4. webhook_backlog: billing_events in received/failed/processing older than 10 minutes.
 */
export async function checkWebhookBacklog(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM billing_events
    WHERE status IN ('received', 'failed', 'processing')
      AND received_at < (now() - interval '10 minutes');
  `);
  const count = rows[0]?.count ?? 0;
  return {
    key: 'webhook_backlog',
    fired: count > 0,
    severity: 'page',
    summary: count > 0 ? `${count} webhook events backlogged (>10m)` : 'Webhook backlog clean',
    details: { backloggedEvents: count },
  };
}

/**
 * 5. dispute_opened: any billing_orders.status = 'disputed' in the last hour.
 */
export async function checkDisputes(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM billing_orders
    WHERE status = 'disputed'
      AND updated_at >= (now() - interval '1 hour');
  `);
  const count = rows[0]?.count ?? 0;
  return {
    key: 'dispute_opened',
    fired: count > 0,
    severity: 'page',
    summary: count > 0 ? `${count} charge disputes opened in the last hour` : 'Zero open disputes',
    details: { disputeCount: count },
  };
}

/**
 * 6. negative_counter: any usage_counters < 0.
 */
export async function checkNegativeCounters(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM usage_counters
    WHERE free_used < 0
       OR queries_used < 0;
  `);
  const count = rows[0]?.count ?? 0;
  return {
    key: 'negative_counter',
    fired: count > 0,
    severity: 'page',
    summary: count > 0 ? `Negative counter anomaly: ${count} rows` : 'Counters invariant valid',
    details: { negativeCount: count },
  };
}

/**
 * 7. ledger_drift: wallet.balance <> sum(ledger.delta).
 */
export async function checkLedgerDrift(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT w.user_id
      FROM credit_wallets w
      LEFT JOIN credit_ledger l ON l.user_id = w.user_id
      GROUP BY w.user_id, w.balance
      HAVING w.balance <> COALESCE(SUM(l.delta), 0)
    ) drift;
  `);
  const count = rows[0]?.count ?? 0;
  return {
    key: 'ledger_drift',
    fired: count > 0,
    severity: 'page',
    summary: count > 0 ? `Ledger drift detected on ${count} wallets` : 'Wallets ledger exact',
    details: { driftWallets: count },
  };
}

/**
 * 8. cap_80 / cap_100: platform usage today vs daily cap.
 */
export async function checkPlatformCap(
  db: AppQueryDb,
  defaultCap: number = 5000,
): Promise<AlertResult> {
  const rows = await db.execute<{
    cap: number | null;
    used: number | null;
  }>(sql`
    SELECT
      (SELECT (value->>'cap')::int FROM platform_flags WHERE key = 'global_daily_platform_cap') AS cap,
      (SELECT SUM(queries_used)::int FROM usage_counters WHERE usage_date = (now() AT TIME ZONE 'UTC')::date) AS used;
  `);
  const cap = rows[0]?.cap ?? defaultCap;
  const used = rows[0]?.used ?? 0;

  if (cap <= 0) {
    return {
      key: 'cap_status',
      fired: false,
      severity: 'info',
      summary: 'Platform cap unconstrained',
      details: { cap, used },
    };
  }

  const ratio = used / cap;
  const fired = ratio >= 0.8;
  const severity: AlertSeverity = ratio >= 1.0 ? 'page' : 'warn';
  const key = ratio >= 1.0 ? 'cap_100' : 'cap_80';

  return {
    key,
    fired,
    severity,
    summary: fired
      ? `Platform daily cap at ${(ratio * 100).toFixed(1)}% (${used}/${cap})`
      : `Platform daily usage normal: ${(ratio * 100).toFixed(1)}% (${used}/${cap})`,
    details: { cap, used, ratio },
  };
}

/**
 * 9. quota_mode_wrong: checks if production has quota enforcement active.
 */
export function checkQuotaMode(
  currentMode: string,
  isProduction: boolean,
  launchActive: boolean,
): AlertResult {
  const fired = isProduction && launchActive && currentMode !== 'enforce';
  return {
    key: 'quota_mode_wrong',
    fired,
    severity: 'page',
    summary: fired
      ? `QUOTA_MODE is '${currentMode}', expected 'enforce' in production`
      : `QUOTA_MODE configuration correct (${currentMode})`,
    details: { currentMode, isProduction, launchActive },
  };
}

/**
 * 10. anon_ip_spike: count of ANON_IP_CAP denials in last 10 minutes.
 */
export async function checkAnonIpSpike(db: AppQueryDb): Promise<AlertResult> {
  const rows = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count
    FROM query_leases
    WHERE status = 'denied'
      AND settle_reason = 'ANON_IP_CAP'
      AND reserved_at >= (now() - interval '10 minutes');
  `);
  const count = rows[0]?.count ?? 0;
  const fired = count > 50;
  return {
    key: 'anon_ip_spike',
    fired,
    severity: 'info',
    summary: fired
      ? `Anonymous IP cap denials spike: ${count} in last 10 minutes`
      : 'Anonymous IP denials normal',
    details: { denialsCount: count },
  };
}

/**
 * Evaluates all SQL-driven alert rules against the active database.
 */
export async function evaluateAllAlertRules(
  db: AppQueryDb,
  envOpts?: {
    quotaMode?: string;
    isProduction?: boolean;
    launchActive?: boolean;
    defaultCap?: number;
  },
): Promise<AlertResult[]> {
  const results = await Promise.all([
    checkLeaseLeak(db),
    checkRefundRatio(db),
    checkLateCommit(db),
    checkWebhookBacklog(db),
    checkDisputes(db),
    checkNegativeCounters(db),
    checkLedgerDrift(db),
    checkPlatformCap(db, envOpts?.defaultCap),
    checkAnonIpSpike(db),
  ]);

  if (envOpts?.quotaMode) {
    results.push(
      checkQuotaMode(
        envOpts.quotaMode,
        envOpts.isProduction ?? false,
        envOpts.launchActive ?? false,
      ),
    );
  }

  return results;
}

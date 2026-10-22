/**
 * Invariant audit queries for metering, billing, and accounting safety.
 *
 * Normative reference: Plan 25 Section 13.8, WP-19.
 * Nightly and on-demand verification of core transactional invariants.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';

export interface AuditAnomaly {
  check: string;
  passed: boolean;
  violationsCount: number;
  sampleViolations: Record<string, unknown>[];
  message: string;
}

/**
 * 1. Wallet balance must strictly equal sum of ledger deltas.
 */
export async function auditWalletLedger(db: AppQueryDb): Promise<AuditAnomaly> {
  type Row = Record<string, unknown> & {
    user_id: string;
    balance: number;
    ledger: number;
  };

  const rows = await db.execute<Row>(sql`
    SELECT w.user_id, w.balance, COALESCE(SUM(l.delta), 0)::int AS ledger
    FROM credit_wallets w
    LEFT JOIN credit_ledger l ON l.user_id = w.user_id
    GROUP BY w.user_id, w.balance
    HAVING w.balance <> COALESCE(SUM(l.delta), 0)
    LIMIT 20;
  `);

  return {
    check: 'wallet_equals_ledger_sum',
    passed: rows.length === 0,
    violationsCount: rows.length,
    sampleViolations: rows,
    message:
      rows.length === 0
        ? 'All credit wallets match ledger sums'
        : `Discrepancy detected in ${rows.length} wallet(s)`,
  };
}

/**
 * 2. User free counter == open/committed daily_free leases (last 2 days).
 */
export async function auditFreeCounterLeases(db: AppQueryDb): Promise<AuditAnomaly> {
  type Row = Record<string, unknown> & {
    subject_id: string;
    usage_date: string;
    free_used: number;
    leases: number;
  };

  const rows = await db.execute<Row>(sql`
    SELECT c.subject_id, c.usage_date::text AS usage_date, c.free_used, COUNT(q.id)::int AS leases
    FROM usage_counters c
    LEFT JOIN query_leases q ON q.user_id::text = c.subject_id
         AND q.usage_date = c.usage_date
         AND q.charge_source = 'daily_free'
         AND q.status IN ('reserved', 'committed')
    WHERE c.subject_kind = 'user'
      AND c.usage_date >= (now() AT TIME ZONE 'UTC')::date - 1
    GROUP BY c.subject_id, c.usage_date, c.free_used
    HAVING c.free_used <> COUNT(q.id)
    LIMIT 20;
  `);

  return {
    check: 'user_free_counter_matches_leases',
    passed: rows.length === 0,
    violationsCount: rows.length,
    sampleViolations: rows,
    message:
      rows.length === 0
        ? 'Free counters match daily_free reserved and committed leases'
        : `Free counter mismatch in ${rows.length} user-date pair(s)`,
  };
}

/**
 * 3. Credit consumption ledger entries match committed credit leases.
 */
export async function auditCreditConsumption(db: AppQueryDb): Promise<AuditAnomaly> {
  type Row = Record<string, unknown> & {
    lease_id: string;
  };

  const rows = await db.execute<Row>(sql`
    SELECT q.id::text AS lease_id
    FROM query_leases q
    LEFT JOIN credit_ledger l ON l.ref_id = q.id::text AND l.source = 'lease'
    WHERE q.charge_source = 'credit_pack'
      AND q.status = 'committed'
      AND l.id IS NULL
    LIMIT 20;
  `);

  return {
    check: 'credit_leases_have_ledger_records',
    passed: rows.length === 0,
    violationsCount: rows.length,
    sampleViolations: rows,
    message:
      rows.length === 0
        ? 'All committed credit leases have corresponding ledger deductions'
        : `Found ${rows.length} committed credit lease(s) missing ledger entries`,
  };
}

/**
 * 4. Subscription usage counters match committed subscription leases for active period.
 */
export async function auditSubscriptionUsage(db: AppQueryDb): Promise<AuditAnomaly> {
  type Row = Record<string, unknown> & {
    subscription_id: string;
    used: number;
    committed_leases: number;
  };

  const rows = await db.execute<Row>(sql`
    SELECT u.subscription_id::text, u.used, COUNT(q.id)::int AS committed_leases
    FROM subscription_usage u
    JOIN subscriptions s ON s.id = u.subscription_id
    LEFT JOIN query_leases q ON q.user_id = s.user_id
         AND q.charge_source = 'subscription'
         AND q.status = 'committed'
         AND q.created_at >= u.period_start
         AND q.created_at < u.period_end
    GROUP BY u.subscription_id, u.used
    HAVING u.used <> COUNT(q.id)
    LIMIT 20;
  `);

  return {
    check: 'subscription_usage_matches_leases',
    passed: rows.length === 0,
    violationsCount: rows.length,
    sampleViolations: rows,
    message:
      rows.length === 0
        ? 'Subscription usage matches active period committed leases'
        : `Subscription usage mismatch in ${rows.length} subscription(s)`,
  };
}

/**
 * 5. Fair charging: committed leases must be paired with delivered turns or chat queries.
 */
export async function auditFairCharging(db: AppQueryDb): Promise<AuditAnomaly> {
  type Row = Record<string, unknown> & {
    lease_id: string;
    created_at: string;
  };

  const rows = await db.execute<Row>(sql`
    SELECT q.id::text AS lease_id, q.created_at::text AS created_at
    FROM query_leases q
    LEFT JOIN recommendation_turns t ON t.lease_id = q.id
    LEFT JOIN chat_queries c ON c.lease_id = q.id
    WHERE q.status = 'committed'
      AND q.created_at >= (now() - interval '24 hours')
      AND t.id IS NULL
      AND c.id IS NULL
    LIMIT 20;
  `);

  return {
    check: 'fair_charging_delivered_turns',
    passed: rows.length === 0,
    violationsCount: rows.length,
    sampleViolations: rows,
    message:
      rows.length === 0
        ? 'All committed leases in last 24h delivered turns or chat queries'
        : `Discovered ${rows.length} committed lease(s) without delivered responses!`,
  };
}

/**
 * Executes all invariant audit checks.
 */
export async function runAllMeteringAudits(db: AppQueryDb): Promise<AuditAnomaly[]> {
  return Promise.all([
    auditWalletLedger(db),
    auditFreeCounterLeases(db),
    auditCreditConsumption(db),
    auditSubscriptionUsage(db),
    auditFairCharging(db),
  ]);
}

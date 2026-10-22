/**
 * Data loader for the /internal/usage operator dashboard.
 *
 * Normative reference: Plan 25 Section 13.5, WP-19.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { getDb } from '@/services/db/client';
import { env } from '@/env';
import { evaluateAllAlertRules, type AlertResult } from '@/services/ops/alert-rules';

export interface UsageDashboardData {
  cap: {
    used: number;
    cap: number;
    ratio: number;
    rung: 'ok' | 'busy' | 'paused';
  };
  flags: Record<
    string,
    { value: Record<string, unknown>; updatedAt: string; updatedBy: string | null }
  >;
  leasesByOutcome: { outcome: string; count: number }[];
  leasesBySource: { source: string; count: number }[];
  denialReasons: { reason: string; count: number }[];
  topDevices: { deviceId: string; count: number }[];
  abuseBlocks: {
    id: string;
    kind: string;
    value: string;
    reason: string | null;
    createdAt: string;
    expiresAt: string | null;
  }[];
  alerts: AlertResult[];
}

export async function loadUsageDashboardData(dbOverride?: AppQueryDb): Promise<UsageDashboardData> {
  const db = dbOverride ?? getDb();

  type FlagRow = Record<string, unknown> & {
    key: string;
    value: Record<string, unknown>;
    updated_at: string;
    updated_by: string | null;
  };

  const [flagRows, capRows, outcomeRows, sourceRows, denialRows, deviceRows, blockRows, alerts] =
    await Promise.all([
      // 1. Flags
      db.execute<FlagRow>(sql`
      SELECT key, value, updated_at::text, updated_by FROM platform_flags ORDER BY key ASC;
    `),

      // 2. Cap & usage today
      db.execute<{ cap: number | null; used: number | null; kill_enabled: boolean | null }>(sql`
      SELECT
        (SELECT (value->>'cap')::int FROM platform_flags WHERE key = 'global_daily_platform_cap') AS cap,
        (SELECT SUM(queries_used)::int FROM usage_counters WHERE usage_date = (now() AT TIME ZONE 'UTC')::date) AS used,
        (SELECT (value->>'enabled')::boolean FROM platform_flags WHERE key = 'kill_switch') AS kill_enabled;
    `),

      // 3. Leases by outcome (24h)
      db.execute<{ outcome: string; count: number }>(sql`
      SELECT status AS outcome, COUNT(*)::int AS count
      FROM query_leases
      WHERE created_at >= (now() - interval '24 hours')
      GROUP BY status
      ORDER BY count DESC;
    `),

      // 4. Leases by source (24h)
      db.execute<{ source: string; count: number }>(sql`
      SELECT charge_source AS source, COUNT(*)::int AS count
      FROM query_leases
      WHERE created_at >= (now() - interval '24 hours')
      GROUP BY charge_source
      ORDER BY count DESC;
    `),

      // 5. Denial reasons (24h)
      db.execute<{ reason: string; count: number }>(sql`
      SELECT denial_reason AS reason, COUNT(*)::int AS count
      FROM query_leases
      WHERE status = 'denied'
        AND created_at >= (now() - interval '24 hours')
        AND denial_reason IS NOT NULL
      GROUP BY denial_reason
      ORDER BY count DESC
      LIMIT 10;
    `),

      // 6. Top device digests (24h)
      db.execute<{ device_id: string; count: number }>(sql`
      SELECT device_id, COUNT(*)::int AS count
      FROM query_leases
      WHERE created_at >= (now() - interval '24 hours')
      GROUP BY device_id
      ORDER BY count DESC
      LIMIT 10;
    `),

      // 7. Abuse blocks
      db.execute<{
        id: string;
        kind: string;
        value: string;
        reason: string | null;
        created_at: string;
        expires_at: string | null;
      }>(sql`
      SELECT
        id::text,
        kind,
        value,
        reason,
        created_at::text,
        expires_at::text
      FROM abuse_blocks
      ORDER BY created_at DESC
      LIMIT 20;
    `),

      // 8. Alerts
      evaluateAllAlertRules(db, {
        quotaMode: env.QUOTA_MODE,
        isProduction: env.NODE_ENV === 'production',
        launchActive: true,
        defaultCap: env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT,
      }),
    ]);

  const flags: Record<
    string,
    { value: Record<string, unknown>; updatedAt: string; updatedBy: string | null }
  > = {};
  for (const r of flagRows) {
    flags[r.key] = { value: r.value, updatedAt: r.updated_at, updatedBy: r.updated_by };
  }

  const cap = capRows[0]?.cap ?? env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT;
  const used = capRows[0]?.used ?? 0;
  const isKilled = Boolean(capRows[0]?.kill_enabled);

  const ratio = cap > 0 ? used / cap : 0;
  const rung: 'ok' | 'busy' | 'paused' = isKilled ? 'paused' : ratio >= 0.8 ? 'busy' : 'ok';

  return {
    cap: { used, cap, ratio, rung },
    flags,
    leasesByOutcome: outcomeRows,
    leasesBySource: sourceRows,
    denialReasons: denialRows,
    topDevices: deviceRows.map((d) => ({ deviceId: d.device_id, count: d.count })),
    abuseBlocks: blockRows.map((b) => ({
      id: b.id,
      kind: b.kind,
      value: b.value,
      reason: b.reason,
      createdAt: b.created_at,
      expiresAt: b.expires_at,
    })),
    alerts,
  };
}

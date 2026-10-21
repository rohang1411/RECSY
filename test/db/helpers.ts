import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { env } from '@/env';
import { createPostgresClient } from '@/services/db/connection';
import { isHostedDatabaseUrl } from '@/services/eval/workload-guard';

export function getDbUrl(): string {
  // eslint-disable-next-line no-restricted-syntax -- allow test override if explicitly set in environment
  return process.env.TEST_DATABASE_URL || env.DATABASE_URL || '';
}

export function isLocalDb(): boolean {
  const url = getDbUrl();
  return Boolean(url && !isHostedDatabaseUrl(url));
}

export function createTestClient(options?: {
  max?: number;
}): ReturnType<typeof createPostgresClient> {
  const url = getDbUrl();
  if (!url) throw new Error('DATABASE_URL is not set');
  return createPostgresClient(url, { max: options?.max ?? 10 });
}

export interface ReserveParams {
  userId?: string | null;
  deviceId?: string;
  ipKey?: string | null;
  requestId?: string;
  route?: string;
  traceId?: string;
  byok?: boolean;
  freeAllowance?: number;
  anonAllowance?: number;
  anonIpCap?: number;
  deviceUserCap?: number;
  byokDailyCap?: number;
  maxInflight?: number;
  leaseTtlSecs?: number;
  shedFree?: boolean;
}

export interface ReserveResult {
  allowed: boolean;
  lease_id: string | null;
  charge_source: string | null;
  reason: string | null;
  free_remaining: number;
  credit_balance: number;
  sub_remaining: number;
  reset_at: string;
}

export async function callReserve(
  sql: postgres.Sql,
  params: ReserveParams = {},
): Promise<ReserveResult> {
  const rows = await sql<ReserveResult[]>`
    SELECT allowed, lease_id, charge_source, reason,
           free_remaining, credit_balance, sub_remaining, reset_at
      FROM recsy_reserve_query(
        ${params.userId ?? null}::uuid,
        ${params.deviceId ?? `dev_${randomUUID()}`},
        ${params.ipKey ?? null},
        ${params.requestId ?? randomUUID()}::uuid,
        ${params.route ?? 'POST /api/recommend'},
        ${params.traceId ?? `tr_${randomUUID().slice(0, 8)}`},
        ${params.byok ?? false},
        ${params.freeAllowance ?? 2},
        ${params.anonAllowance ?? 2},
        ${params.anonIpCap ?? 30},
        ${params.deviceUserCap ?? 3},
        ${params.byokDailyCap ?? 100},
        ${params.maxInflight ?? 1},
        ${params.leaseTtlSecs ?? 75},
        ${params.shedFree ?? false}
      )
  `;
  if (!rows[0]) throw new Error('recsy_reserve_query returned no rows');
  return rows[0];
}

export async function callSettle(
  sql: postgres.Sql,
  leaseId: string,
  outcome: 'commit' | 'refund' | 'no_charge' | 'expire',
  reason?: string,
  clarifyFreeCap = 10,
): Promise<string | null> {
  const rows = await sql<{ recsy_settle_lease: string | null }[]>`
    SELECT recsy_settle_lease(
      ${leaseId}::uuid,
      ${outcome},
      ${reason ?? null},
      NULL, NULL, NULL, NULL, NULL, NULL,
      ${clarifyFreeCap}
    )
  `;
  return rows[0]?.recsy_settle_lease ?? null;
}

export async function callApplyCreditDelta(
  sql: postgres.Sql,
  userId: string,
  delta: number,
  kind: 'grant' | 'consume' | 'refund' | 'adjustment' | 'expiry',
  refType: string,
  refId: string,
  idemKey: string,
  metadata: Record<string, unknown> = {},
): Promise<{ applied: boolean; balance: number }> {
  const rows = await sql<{ applied: boolean; balance: number }[]>`
    SELECT applied, balance
      FROM recsy_apply_credit_delta(
        ${userId}::uuid,
        ${delta},
        ${kind}::ledger_kind,
        ${refType},
        ${refId},
        ${idemKey},
        ${JSON.stringify(metadata)}::jsonb
      )
  `;
  if (!rows[0]) throw new Error('recsy_apply_credit_delta returned no rows');
  return rows[0];
}

export async function callSweepExpired(sql: postgres.Sql, limit = 200): Promise<number> {
  const rows = await sql<{ recsy_sweep_expired_leases: number }[]>`
    SELECT recsy_sweep_expired_leases(${limit})
  `;
  return rows[0]?.recsy_sweep_expired_leases ?? 0;
}

export async function callLinkDevice(
  sql: postgres.Sql,
  userId: string,
  deviceId: string,
): Promise<number> {
  const rows = await sql<{ recsy_link_device_to_user: number }[]>`
    SELECT recsy_link_device_to_user(${userId}::uuid, ${deviceId})
  `;
  return rows[0]?.recsy_link_device_to_user ?? 0;
}

export async function cleanupTestRecords(
  sql: postgres.Sql,
  target: {
    userIds?: string[];
    deviceIds?: string[];
    ipKeys?: string[];
    leaseIds?: string[];
  },
): Promise<void> {
  const { userIds = [], deviceIds = [], ipKeys = [], leaseIds = [] } = target;

  if (leaseIds.length > 0) {
    await sql`DELETE FROM query_leases WHERE id = ANY(${leaseIds}::uuid[])`;
  }
  if (userIds.length > 0) {
    await sql`DELETE FROM query_leases WHERE user_id = ANY(${userIds}::uuid[])`;
    await sql`DELETE FROM credit_ledger WHERE user_id = ANY(${userIds}::uuid[])`;
    await sql`DELETE FROM credit_wallets WHERE user_id = ANY(${userIds}::uuid[])`;
    await sql`DELETE FROM subscription_usage WHERE subscription_id IN (
      SELECT id FROM subscriptions WHERE user_id = ANY(${userIds}::uuid[])
    )`;
    await sql`DELETE FROM subscriptions WHERE user_id = ANY(${userIds}::uuid[])`;
    await sql`DELETE FROM usage_counters WHERE subject_kind = 'user' AND subject_id = ANY(${userIds})`;
    await sql`DELETE FROM user_profiles WHERE id = ANY(${userIds}::uuid[])`;
  }
  if (deviceIds.length > 0) {
    await sql`DELETE FROM query_leases WHERE device_id = ANY(${deviceIds})`;
    await sql`DELETE FROM usage_counters WHERE subject_kind = 'device' AND subject_id = ANY(${deviceIds})`;
  }
  if (ipKeys.length > 0) {
    await sql`DELETE FROM query_leases WHERE ip_key = ANY(${ipKeys})`;
    await sql`DELETE FROM usage_counters WHERE subject_kind = 'ip' AND subject_id = ANY(${ipKeys})`;
  }
}

import { sql } from 'drizzle-orm';
import { logger } from '@/services/logger';
import { AppError, QuotaDeniedError, type ErrorCode } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';
import type { ChargeSource, MeteringConfig, QuotaSnapshotLite, ReserveDenial } from './types';
import { QueryLease } from './lease';

const log = logger.child({ component: 'metering-reserve' });

export interface RequestIdentityLite {
  readonly userId: string | null;
  readonly deviceId: string;
  readonly ipKey: string | null;
  readonly isSuspended?: boolean;
}

export interface ReserveQueryInput {
  readonly db: AppQueryDb;
  readonly identity: RequestIdentityLite;
  readonly requestId: string;
  readonly route: 'POST /api/recommend' | 'POST /api/ask';
  readonly traceId: string;
  readonly byok: boolean;
  readonly shedFree: boolean;
  readonly config: MeteringConfig;
}

type RawReserveRow = Record<string, unknown> & {
  allowed: boolean;
  lease_id: string | null;
  charge_source: ChargeSource | null;
  reason: ReserveDenial | null;
  free_remaining: number;
  credit_balance: number;
  sub_remaining: number;
  reset_at: Date | string;
};

function resolveDenialActions(reason: ReserveDenial, signedIn: boolean): readonly string[] {
  switch (reason) {
    case 'SIGNIN_REQUIRED':
      return ['sign_in'];
    case 'CAPACITY_BUSY':
      return ['sign_in', 'byok'];
    case 'ANON_IP_CAP':
    case 'ANON_QUOTA_EXHAUSTED':
      return signedIn
        ? ['buy_credits', 'subscribe', 'byok']
        : ['sign_in', 'buy_credits', 'subscribe', 'byok'];
    case 'SUBSCRIPTION_EXHAUSTED':
      return ['buy_credits', 'byok'];
    case 'BYOK_DAILY_CAP':
      return ['buy_credits', 'subscribe'];
    case 'QUOTA_EXHAUSTED':
    case 'DEVICE_ACCOUNT_CAP':
    default:
      return signedIn
        ? ['buy_credits', 'subscribe', 'byok']
        : ['sign_in', 'buy_credits', 'subscribe', 'byok'];
  }
}

function mapDenialToErrorCode(reason: ReserveDenial): ErrorCode {
  switch (reason) {
    case 'SIGNIN_REQUIRED':
      return 'SIGNIN_REQUIRED';
    case 'TOO_MANY_INFLIGHT':
      return 'TOO_MANY_INFLIGHT';
    case 'DUPLICATE_REQUEST':
      return 'DUPLICATE_REQUEST';
    case 'CAPACITY_BUSY':
      return 'CAPACITY_BUSY';
    case 'PLATFORM_PAUSED':
      return 'PLATFORM_PAUSED';
    case 'METERING_UNAVAILABLE':
      return 'METERING_UNAVAILABLE';
    default:
      return 'QUOTA_EXHAUSTED';
  }
}

function mapDenialToStatus(reason: ReserveDenial): number {
  switch (reason) {
    case 'TOO_MANY_INFLIGHT':
      return 429;
    case 'DUPLICATE_REQUEST':
      return 409;
    case 'CAPACITY_BUSY':
    case 'PLATFORM_PAUSED':
    case 'METERING_UNAVAILABLE':
      return 503;
    default:
      return 402;
  }
}

/**
 * Executes recsy_reserve_query with a statement timeout and deadlock (40P01) single retry.
 */
async function callReserveStoredFunction(
  client: AppQueryDb,
  input: ReserveQueryInput,
  maxInflight: number,
): Promise<RawReserveRow> {
  const attempt = async () => {
    const rows = await client.execute<RawReserveRow>(sql`
      SELECT * FROM recsy_reserve_query(
        ${input.identity.userId ? sql`${input.identity.userId}::uuid` : sql`NULL`},
        ${input.identity.deviceId},
        ${input.identity.ipKey ?? null},
        ${input.requestId}::uuid,
        ${input.route},
        ${input.traceId},
        ${input.byok},
        ${input.config.freeDailyQueries},
        ${input.config.anonDailyQueries},
        ${input.config.anonIpDailyCap},
        ${input.config.deviceAccountCap},
        ${input.config.byokDailyCap},
        ${maxInflight},
        ${input.config.leaseTtlSeconds},
        ${input.shedFree}
      );
    `);
    const row = rows[0];
    if (!row) {
      throw new AppError(
        'METERING_UNAVAILABLE',
        'Metering service returned an empty reservation result',
        { status: 503 },
      );
    }
    return row;
  };

  try {
    return await attempt();
  } catch (err: unknown) {
    // 40P01 is PostgreSQL's deadlock_detected error code
    const isDeadlock =
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: unknown }).code === '40P01';

    if (isDeadlock) {
      log.warn({ traceId: input.traceId }, 'deadlock detected during reserve; retrying once');
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 25));
      return await attempt();
    }
    throw err;
  }
}

/**
 * Reserves one query under the current metering mode (off | shadow | enforce).
 * Throws QuotaDeniedError on denial in enforce mode.
 */
export async function reserveQuery(input: ReserveQueryInput): Promise<QueryLease> {
  // 1. Quota mode off: return no-op lease with zero DB calls
  if (input.config.mode === 'off') {
    return new QueryLease({
      id: 'off',
      chargeSource: input.byok ? 'byok' : input.identity.userId ? 'daily_free' : 'anon_free',
      quota: {
        remaining: 999,
        freeRemaining: 999,
        creditBalance: 0,
        subRemaining: 0,
        resetAt: new Date(Date.now() + 86400000).toISOString(),
      },
      requestId: input.requestId,
      route: input.route,
      deviceId: input.identity.deviceId,
      userId: input.identity.userId,
      traceId: input.traceId,
      isNoop: true,
      db: input.db,
    });
  }

  // 2. Initial reserve attempt with MAX_INFLIGHT_FREE
  let row = await callReserveStoredFunction(input.db, input, input.config.maxInflightFree);

  // 3. Pro in-flight re-check: if denied due to inflight and user is signed in,
  //    check if user has an active Pro subscription and re-reserve once with MAX_INFLIGHT_PRO.
  if (!row.allowed && row.reason === 'TOO_MANY_INFLIGHT' && input.identity.userId) {
    const subCheck = await input.db.execute<{ count: string | number }>(sql`
      SELECT count(*) as count FROM subscriptions
       WHERE user_id = ${input.identity.userId}::uuid
         AND entitled_until > now();
    `);
    const isPro = Number(subCheck[0]?.count ?? 0) > 0;
    if (isPro) {
      row = await callReserveStoredFunction(input.db, input, input.config.maxInflightPro);
    }
  }

  const resetAtIso =
    row.reset_at instanceof Date
      ? row.reset_at.toISOString()
      : new Date(row.reset_at).toISOString();

  // 4. Allowed path
  if (row.allowed && row.lease_id && row.charge_source) {
    const remaining =
      row.charge_source === 'daily_free' || row.charge_source === 'anon_free'
        ? row.free_remaining
        : row.charge_source === 'subscription'
          ? row.sub_remaining
          : row.charge_source === 'credit'
            ? row.credit_balance
            : row.free_remaining + row.sub_remaining + row.credit_balance;

    const quota: QuotaSnapshotLite = {
      remaining,
      freeRemaining: row.free_remaining,
      creditBalance: row.credit_balance,
      subRemaining: row.sub_remaining,
      resetAt: resetAtIso,
      chargeSource: row.charge_source,
    };

    log.info(
      {
        traceId: input.traceId,
        leaseId: row.lease_id,
        chargeSource: row.charge_source,
        remaining,
      },
      'quota_reserved',
    );

    return new QueryLease({
      id: row.lease_id,
      chargeSource: row.charge_source,
      quota,
      requestId: input.requestId,
      route: input.route,
      deviceId: input.identity.deviceId,
      userId: input.identity.userId,
      traceId: input.traceId,
      db: input.db,
    });
  }

  // 5. Denied path
  const reason = row.reason ?? 'QUOTA_EXHAUSTED';
  const signedIn = Boolean(input.identity.userId);
  const actions = resolveDenialActions(reason, signedIn);
  const errorCode = mapDenialToErrorCode(reason);
  const status = mapDenialToStatus(reason);

  const quotaPayload = {
    reason,
    resetAt: resetAtIso,
    signedIn,
    credits: row.credit_balance,
    freeRemaining: row.free_remaining,
    subRemaining: row.sub_remaining,
  };

  // In shadow mode, log denial and return a no-op lease so the caller proceeds unblocked
  if (input.config.mode === 'shadow') {
    log.info(
      {
        traceId: input.traceId,
        reason,
        quota: quotaPayload,
      },
      'quota_shadow_deny',
    );

    return new QueryLease({
      id: 'off',
      chargeSource: input.byok ? 'byok' : input.identity.userId ? 'daily_free' : 'anon_free',
      quota: {
        remaining: 0,
        freeRemaining: row.free_remaining,
        creditBalance: row.credit_balance,
        subRemaining: row.sub_remaining,
        resetAt: resetAtIso,
      },
      requestId: input.requestId,
      route: input.route,
      deviceId: input.identity.deviceId,
      userId: input.identity.userId,
      traceId: input.traceId,
      isNoop: true,
      db: input.db,
    });
  }

  // In enforce mode, log and throw QuotaDeniedError
  log.warn(
    {
      traceId: input.traceId,
      reason,
      quota: quotaPayload,
    },
    'quota_denied',
  );

  throw new QuotaDeniedError(errorCode, `Query reservation denied: ${reason}`, {
    status,
    quota: quotaPayload,
    actions,
  });
}

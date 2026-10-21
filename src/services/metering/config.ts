import { env } from '@/env';
import { isHostedDatabaseUrl } from '@/services/eval/workload-guard';
import type { MeteringConfig } from './types';

/**
 * Derives and freezes the active MeteringConfig from environment variables.
 * Enforces safety forcing rules per Section 7.1 of plan 25:
 *   - Forced to 'off' when LLM_PROVIDER === 'controlled' or DATABASE_SCHEMA !== 'public'.
 *   - Overridden back to configured mode only if QUOTA_TEST_OVERRIDE === '1' AND
 *     the DATABASE_URL is verified to be a local database (not hosted).
 */
export function getMeteringConfig(overrides?: Partial<MeteringConfig>): MeteringConfig {
  let mode: 'off' | 'shadow' | 'enforce' = env.QUOTA_MODE;

  const isControlledLlm = env.LLM_PROVIDER === 'controlled';
  const isNonPublicSchema = env.DATABASE_SCHEMA !== 'public';

  if (isControlledLlm || isNonPublicSchema) {
    const isLocalDb = !isHostedDatabaseUrl(env.DATABASE_URL);
    const allowOverride = env.QUOTA_TEST_OVERRIDE === '1' && isLocalDb;
    if (!allowOverride) {
      mode = 'off';
    }
  }

  const base: MeteringConfig = {
    mode,
    freeDailyQueries: env.FREE_DAILY_QUERIES,
    anonDailyQueries: env.ANON_DAILY_QUERIES,
    anonIpDailyCap: env.ANON_IP_DAILY_CAP,
    deviceAccountCap: env.DEVICE_ACCOUNT_CAP,
    byokDailyCap: env.BYOK_DAILY_CAP,
    clarifyFreeCap: env.CLARIFY_FREE_CAP,
    maxInflightFree: env.MAX_INFLIGHT_FREE,
    maxInflightPro: env.MAX_INFLIGHT_PRO,
    leaseTtlSeconds: env.LEASE_TTL_SECONDS,
    dbTimeoutMs: env.METERING_DB_TIMEOUT_MS,
    globalDailyPlatformCap: env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT,
  };

  if (overrides) {
    return Object.freeze({ ...base, ...overrides });
  }

  return Object.freeze(base);
}

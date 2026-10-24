import { sql } from 'drizzle-orm';
import { env } from '@/env';
import { AppError } from '@/lib/errors';
import { logger } from '@/services/logger';
import type { AppQueryDb } from '@/services/db/client';
import { parsePerfFlags, type PerfFlags } from '@/services/perf/flags';
import type { PlatformState } from './types';

const log = logger.child({ component: 'platform-state' });

const PLATFORM_STATE_CACHE_TTL_MS = 10_000;

let hits = 0;
let misses = 0;

export function getCacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

interface CachedState {
  state: PlatformState;
  cachedAt: number;
}

let cachedPlatformState: CachedState | null = null;
let inFlightPromise: Promise<PlatformState> | null = null;

function parseKillSwitch(raw: unknown): { enabled: boolean; message?: string } {
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    return {
      enabled: Boolean(obj.enabled),
      message: typeof obj.message === 'string' ? obj.message : undefined,
    };
  }
  return { enabled: false };
}

function parseCap(raw: unknown, defaultCap: number): number {
  if (typeof raw === 'number') return Math.max(0, Math.floor(raw));
  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.cap === 'number') return Math.max(0, Math.floor(obj.cap));
    if (typeof obj.value === 'number') return Math.max(0, Math.floor(obj.value));
  }
  return Math.max(0, defaultCap);
}

function buildPlatformState(
  killSwitchRaw: unknown,
  capRaw: unknown,
  usedTodayRaw: unknown,
  perfFlagsRaw?: unknown,
): PlatformState {
  const killSwitch = parseKillSwitch(killSwitchRaw);
  const globalDailyCap = parseCap(capRaw, env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT);
  const usedToday =
    typeof usedTodayRaw === 'number'
      ? usedTodayRaw
      : Number.parseInt(String(usedTodayRaw ?? 0), 10) || 0;
  const perf = parsePerfFlags(perfFlagsRaw);

  let capacity: 'ok' | 'busy' | 'paused' = 'ok';
  if (killSwitch.enabled) {
    capacity = 'paused';
  } else if (globalDailyCap > 0 && usedToday >= 0.8 * globalDailyCap) {
    capacity = 'busy';
  }

  return {
    killSwitch,
    globalDailyCap,
    usedToday,
    capacity,
    perf,
    shedFreeFor(_identity: { userId: string | null }): boolean {
      if (globalDailyCap <= 0) return false;
      return usedToday >= 1.0 * globalDailyCap;
    },
  };
}

export function getDefaultPlatformState(): PlatformState {
  return buildPlatformState(
    { enabled: false },
    env.GLOBAL_DAILY_PLATFORM_CAP_DEFAULT,
    0,
    undefined,
  );
}

/**
 * Fetches the platform admission state with single-flight deduplication
 * and a 10-second in-memory cache. Falls back to stale value on DB failure.
 */
export async function getPlatformState(db: AppQueryDb): Promise<PlatformState> {
  const now = Date.now();

  if (cachedPlatformState && now - cachedPlatformState.cachedAt < PLATFORM_STATE_CACHE_TTL_MS) {
    hits++;
    return cachedPlatformState.state;
  }

  misses++;

  if (inFlightPromise) {
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      const result = await db.execute<{
        kill_switch: unknown;
        cap: unknown;
        perf_flags: unknown;
        used_today: string | number;
      }>(sql`
        SELECT
          (SELECT value FROM platform_flags WHERE key = 'kill_switch')               AS kill_switch,
          (SELECT value FROM platform_flags WHERE key = 'global_daily_platform_cap') AS cap,
          (SELECT value FROM platform_flags WHERE key = 'perf_flags')                AS perf_flags,
          (SELECT count(*) FROM query_leases
             WHERE reserved_at >= ((now() AT TIME ZONE 'UTC')::date)::timestamp AT TIME ZONE 'UTC'
               AND charge_source <> 'byok' AND status IN ('reserved','committed')) AS used_today;
      `);

      const row = result[0] ?? {
        kill_switch: null,
        cap: null,
        perf_flags: null,
        used_today: 0,
      };

      const newState = buildPlatformState(row.kill_switch, row.cap, row.used_today, row.perf_flags);

      cachedPlatformState = {
        state: newState,
        cachedAt: Date.now(),
      };

      return newState;
    } catch (err) {
      log.warn({ err }, 'failed to read platform state; serving stale or default');
      if (cachedPlatformState) {
        return cachedPlatformState.state;
      }
      return getDefaultPlatformState();
    } finally {
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

/**
 * Asserts that the platform accepts a metered request.
 * Throws 503 PLATFORM_PAUSED or 503 CAPACITY_BUSY when appropriate.
 */
export function assertPlatformAcceptsRequest(
  platform: PlatformState,
  identity: { userId: string | null },
  byok: boolean = false,
): void {
  // 1. Kill switch pauses all non-BYOK requests
  if (platform.killSwitch.enabled) {
    if (byok) return;
    throw new AppError(
      'PLATFORM_PAUSED',
      platform.killSwitch.message || 'RECSY is paused for scheduled maintenance.',
      { status: 503 },
    );
  }

  // 2. Capacity busy sheds anonymous non-BYOK requests
  if (platform.capacity === 'busy') {
    if (byok || identity.userId !== null) return;
    throw new AppError(
      'CAPACITY_BUSY',
      'High platform demand. Please sign in or try again later.',
      {
        status: 503,
        context: {
          actions: ['sign_in', 'byok'],
        },
      },
    );
  }
}

/**
 * Resets the in-memory platform state cache (for tests).
 */
export function resetPlatformStateCache(): void {
  cachedPlatformState = null;
  inFlightPromise = null;
  hits = 0;
  misses = 0;
}

/**
 * Returns runtime performance flags cached with platform state.
 */
export async function getPerfFlags(db: AppQueryDb): Promise<PerfFlags> {
  const state = await getPlatformState(db);
  return state.perf;
}

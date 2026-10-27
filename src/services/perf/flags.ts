/**
 * Runtime Performance Flags and Kill Switches (Plan 26 WP-01).
 *
 * Provides sub-10s kill-switches and canary rollouts without redeploying.
 * Stored as jsonb in `platform_flags` under the key 'perf_flags' and cached
 * in-memory alongside platform state with a 10s TTL.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { env } from '@/env';
import { logger } from '@/services/logger';
import type { AppQueryDb } from '@/services/db/client';

const log = logger.child({ component: 'perf-flags' });

export const PERF_FLAGS_KEY = 'perf_flags';

export const perfFlagsSchema = z
  .object({
    ask_streaming: z.enum(['off', 'shadow', 'canary', 'on']).default('off'),
    ask_streaming_canary_pct: z.number().int().min(0).max(100).default(0),
    auth_local_claims: z.boolean().default(false),
    admission_single_statement: z.boolean().default(true),
    public_data_cache: z.boolean().default(true),
    defer_telemetry: z.boolean().default(true),
    redis_rate_limit: z.boolean().default(false),
    grounded_thinking: z.enum(['default', 'low', 'minimal']).default('default'),
    // Plan 27 WP-02: Product flags housed in the perf flag blob to reuse its 10s in-memory cache and admin route
    recommend_sessions: z.enum(['off', 'internal', 'on']).default('off'),
    recommend_sessions_internal_user_ids: z.array(z.string().uuid()).default([]),
    recommend_session_llm_titles: z.boolean().default(false),
  })
  .strict();

export type PerfFlags = z.infer<typeof perfFlagsSchema>;
export const DEFAULT_PERF_FLAGS: PerfFlags = perfFlagsSchema.parse({});

let hasLoggedInvalidFlags = false;

function getEnvDefaultPerfFlags(): PerfFlags {
  const rawEnv = env.PERF_FLAGS_DEFAULT_JSON?.trim();
  if (!rawEnv) {
    return DEFAULT_PERF_FLAGS;
  }
  try {
    const parsed = JSON.parse(rawEnv);
    const result = perfFlagsSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }
    log.warn(
      { err: result.error },
      'invalid PERF_FLAGS_DEFAULT_JSON format; falling back to DEFAULT_PERF_FLAGS',
    );
    return DEFAULT_PERF_FLAGS;
  } catch (err) {
    log.warn(
      { err },
      'failed to parse PERF_FLAGS_DEFAULT_JSON as JSON; falling back to DEFAULT_PERF_FLAGS',
    );
    return DEFAULT_PERF_FLAGS;
  }
}

/**
 * Parses the stored jsonb. Unknown or invalid content falls back to defaults and logs once.
 */
export function parsePerfFlags(raw: unknown): PerfFlags {
  const baseDefaults = getEnvDefaultPerfFlags();

  if (raw === null || raw === undefined) {
    return baseDefaults;
  }

  let obj = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      if (!hasLoggedInvalidFlags) {
        hasLoggedInvalidFlags = true;
        log.warn({ raw }, 'malformed JSON in perf_flags; falling back to defaults');
      }
      return baseDefaults;
    }
  }

  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    if (!hasLoggedInvalidFlags) {
      hasLoggedInvalidFlags = true;
      log.warn({ raw }, 'perf_flags is not a JSON object; falling back to defaults');
    }
    return baseDefaults;
  }

  // Try strict parse first
  const strictResult = perfFlagsSchema.safeParse(obj);
  if (strictResult.success) {
    return strictResult.data;
  }

  // If strict parse failed, see if strip() succeeds (meaning unknown keys were present)
  const strippedSchema = perfFlagsSchema.strip();
  const strippedResult = strippedSchema.safeParse(obj);
  if (strippedResult.success) {
    if (!hasLoggedInvalidFlags) {
      hasLoggedInvalidFlags = true;
      log.warn(
        { error: strictResult.error },
        'perf_flags contained unknown keys; stripped extra keys and applied valid flags',
      );
    }
    return strippedResult.data;
  }

  // Completely invalid fields (e.g. invalid enum value or bad types)
  if (!hasLoggedInvalidFlags) {
    hasLoggedInvalidFlags = true;
    log.warn(
      { error: strictResult.error },
      'invalid values in perf_flags; falling back to defaults',
    );
  }
  return baseDefaults;
}

/**
 * Reset logger warning latch (primarily for unit tests).
 */
export function resetPerfFlagsLogLatch(): void {
  hasLoggedInvalidFlags = false;
}

/**
 * Deterministic canary bucketing: first 4 bytes of sha256('ask_streaming:' + deviceId) mod 100 < pct (Appendix 15.5).
 */
export function inCanary(deviceId: string, pct: number): boolean {
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  const h = createHash('sha256').update(`ask_streaming:${deviceId}`).digest();
  return h.readUInt32BE(0) % 100 < pct;
}

/**
 * Helper for routes and pages that do not otherwise need platform state:
 * calls getPlatformState(db) and returns .perf
 */
export async function getPerfFlags(db: AppQueryDb): Promise<PerfFlags> {
  const { getPlatformState } = await import('@/services/metering/platform');
  const state = await getPlatformState(db);
  return state.perf;
}

/**
 * Checks if recommendation sessions v2 is enabled for the caller.
 * - 'on': enabled for everyone
 * - 'internal': enabled only if userId is in recommend_sessions_internal_user_ids
 * - 'off': disabled for everyone
 */
export function isRecommendSessionsEnabled(flags: PerfFlags, userId?: string | null): boolean {
  if (flags.recommend_sessions === 'on') return true;
  if (flags.recommend_sessions === 'internal') {
    return Boolean(userId && flags.recommend_sessions_internal_user_ids.includes(userId));
  }
  return false;
}

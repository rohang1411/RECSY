import {
  ASK_RATE_LIMIT_MAX,
  ASK_RATE_LIMIT_WINDOW_MS,
  RECOMMEND_RATE_LIMIT_MAX,
  RECOMMEND_RATE_LIMIT_WINDOW_MS,
} from '@/lib/constants';
import { RateLimitError } from '@/lib/errors';
import type { RequestIdentity } from '@/services/auth/identity';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import {
  DEVICE_ASK_RATE_LIMIT_MAX,
  DEVICE_RECOMMEND_RATE_LIMIT_MAX,
  consumeDeviceRateLimit,
  deviceRateLimitKey,
} from '@/services/abuse/rate-limit-device';
import {
  USER_ASK_RATE_LIMIT_MAX,
  USER_RATE_LIMIT_WINDOW_MS,
  USER_RECOMMEND_RATE_LIMIT_MAX,
  consumeUserRateLimit,
  userRateLimitKey,
} from '@/services/metering/rate-limit-user';

import {
  askRateLimitKey,
  consumeAskRateLimit,
  consumeRecommendRateLimit,
  recommendRateLimitKey,
} from './consume';
import { hashClientIp } from './ip-hash';
import {
  PostgresRateLimitStore,
  type RateLimitCheck,
  type RateLimitOutcome,
  type RateLimitStore,
  incrementRateLimitStoreErrors,
} from './store';

const log = logger.child({ component: 'admission-rate-limit' });

export interface ConsumeAdmissionLimitsParams {
  readonly db: AppQueryDb;
  readonly ip: string;
  readonly identity: RequestIdentity;
  readonly route: 'ask' | 'recommend';
  readonly store?: RateLimitStore;
  readonly nowMs?: number;
  readonly singleStatement?: boolean;
}

export function buildAdmissionChecks(params: {
  readonly ip: string;
  readonly identity: RequestIdentity;
  readonly route: 'ask' | 'recommend';
}): RateLimitCheck[] {
  const { ip, identity, route } = params;
  const ipHash = hashClientIp(ip);
  const checks: RateLimitCheck[] = [];

  if (route === 'ask') {
    checks.push({
      key: askRateLimitKey(ipHash),
      windowMs: ASK_RATE_LIMIT_WINDOW_MS,
      max: ASK_RATE_LIMIT_MAX,
      subject: 'ip',
    });

    if (identity.userId) {
      checks.push({
        key: userRateLimitKey('ask', identity.userId),
        windowMs: USER_RATE_LIMIT_WINDOW_MS,
        max: USER_ASK_RATE_LIMIT_MAX,
        subject: 'user',
      });
    }

    if (identity.deviceId && identity.deviceId.trim()) {
      checks.push({
        key: deviceRateLimitKey(identity.deviceId, 'POST /api/ask'),
        windowMs: 60_000,
        max: DEVICE_ASK_RATE_LIMIT_MAX,
        subject: 'device',
      });
    }
  } else {
    checks.push({
      key: recommendRateLimitKey(ipHash),
      windowMs: RECOMMEND_RATE_LIMIT_WINDOW_MS,
      max: RECOMMEND_RATE_LIMIT_MAX,
      subject: 'ip',
    });

    if (identity.userId) {
      checks.push({
        key: userRateLimitKey('recommend', identity.userId),
        windowMs: USER_RATE_LIMIT_WINDOW_MS,
        max: USER_RECOMMEND_RATE_LIMIT_MAX,
        subject: 'user',
      });
    }

    if (identity.deviceId && identity.deviceId.trim()) {
      checks.push({
        key: deviceRateLimitKey(identity.deviceId, 'POST /api/recommend'),
        windowMs: 60_000,
        max: DEVICE_RECOMMEND_RATE_LIMIT_MAX,
        subject: 'device',
      });
    }
  }

  return checks;
}

/**
 * Consumes all admission rate limits (IP, user, device) in a single database round trip.
 * Fails open on store error (rule R3), logging a warning and incrementing the error counter.
 */
export async function consumeAdmissionLimits(params: ConsumeAdmissionLimitsParams): Promise<void> {
  const { db, ip, identity, route, store, nowMs = Date.now(), singleStatement = true } = params;

  // Fallback path when single-statement flag is disabled
  if (!singleStatement) {
    if (route === 'ask') {
      await consumeAskRateLimit(ip, db);
      if (identity.userId) {
        await consumeUserRateLimit(identity.userId, 'ask', db);
      }
      if (identity.deviceId) {
        await consumeDeviceRateLimit(db, identity.deviceId, 'POST /api/ask');
      }
    } else {
      await consumeRecommendRateLimit(ip, db);
      if (identity.userId) {
        await consumeUserRateLimit(identity.userId, 'recommend', db);
      }
      if (identity.deviceId) {
        await consumeDeviceRateLimit(db, identity.deviceId, 'POST /api/recommend');
      }
    }
    return;
  }

  const checks = buildAdmissionChecks({ ip, identity, route });
  const activeStore = store ?? new PostgresRateLimitStore(db);

  let outcomes: RateLimitOutcome[];
  try {
    outcomes = await activeStore.consume(checks, nowMs);
  } catch (err) {
    incrementRateLimitStoreErrors();
    log.warn({ err, store: activeStore.name, route }, 'rate_limit_store_error');
    return; // Fail open (rule R3)
  }

  const outcomeByKey = new Map<string, RateLimitOutcome>();
  for (const outcome of outcomes) {
    outcomeByKey.set(outcome.key, outcome);
  }

  // Check limited outcomes in fixed order: IP -> User -> Device
  const ipCheck = checks.find((c) => c.subject === 'ip');
  if (ipCheck) {
    const outcome = outcomeByKey.get(ipCheck.key);
    if (outcome?.limited) {
      const windowStart = new Date(Math.floor(nowMs / ipCheck.windowMs) * ipCheck.windowMs);
      throw new RateLimitError({ windowStart: windowStart.toISOString() });
    }
  }

  const userCheck = checks.find((c) => c.subject === 'user');
  if (userCheck) {
    const outcome = outcomeByKey.get(userCheck.key);
    if (outcome?.limited) {
      const windowStart = new Date(Math.floor(nowMs / userCheck.windowMs) * userCheck.windowMs);
      throw new RateLimitError({
        windowStart: windowStart.toISOString(),
        route,
        maxAllowed: userCheck.max,
        userId: identity.userId,
      });
    }
  }

  const deviceCheck = checks.find((c) => c.subject === 'device');
  if (deviceCheck) {
    const outcome = outcomeByKey.get(deviceCheck.key);
    if (outcome?.limited) {
      throw new RateLimitError({
        limit: deviceCheck.max,
        current: outcome.count,
        subject: 'device',
      });
    }
  }
}

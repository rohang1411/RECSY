import { RateLimitError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { PostgresRateLimitStore, incrementRateLimitStoreErrors } from '@/services/rate-limit/store';

const log = logger.child({ component: 'rate-limit-device' });

export const DEVICE_RECOMMEND_RATE_LIMIT_MAX = 15; // 15 calls per minute
export const DEVICE_ASK_RATE_LIMIT_MAX = 25; // 25 calls per minute
export const DEVICE_READ_RATE_LIMIT_MAX = 60; // 60 calls per minute

export type DeviceRateLimitRoute = 'POST /api/recommend' | 'POST /api/ask' | 'GET /api/me';

export function deviceRateLimitKey(deviceId: string, route: DeviceRateLimitRoute): string {
  const shortRoute =
    route === 'POST /api/recommend' ? 'rec' : route === 'POST /api/ask' ? 'ask' : 'me';
  return `dev_rl:${shortRoute}:${deviceId.trim()}`;
}

/**
 * Enforces per-device burst rate limits (Section 7.5, Section 8.7).
 * Atomically increments counter in `rate_limits` for the current minute window.
 * Throws RateLimitError when maximum threshold is exceeded.
 * Fails open on transient database errors (rule R3).
 */
export async function consumeDeviceRateLimit(
  db: AppQueryDb,
  deviceId: string | null | undefined,
  route: DeviceRateLimitRoute,
): Promise<void> {
  if (!deviceId || !deviceId.trim()) {
    return;
  }

  const maxAllowed =
    route === 'POST /api/recommend'
      ? DEVICE_RECOMMEND_RATE_LIMIT_MAX
      : route === 'POST /api/ask'
        ? DEVICE_ASK_RATE_LIMIT_MAX
        : DEVICE_READ_RATE_LIMIT_MAX;

  const key = deviceRateLimitKey(deviceId, route);
  const store = new PostgresRateLimitStore(db);
  const nowMs = Date.now();

  try {
    const [outcome] = await store.consume(
      [{ key, windowMs: 60_000, max: maxAllowed, subject: 'device' }],
      nowMs,
    );

    if (outcome?.limited) {
      throw new RateLimitError({
        limit: maxAllowed,
        current: outcome.count,
        subject: 'device',
      });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route, deviceId }, 'rate_limit_store_error');
    // Fail-open on transient database rate-limiting errors to prevent blocking legitimate traffic
  }
}

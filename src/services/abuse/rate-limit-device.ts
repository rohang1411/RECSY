import { sql } from 'drizzle-orm';
import { RateLimitError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';

export const DEVICE_RECOMMEND_RATE_LIMIT_MAX = 15; // 15 calls per minute
export const DEVICE_ASK_RATE_LIMIT_MAX = 25; // 25 calls per minute

export function deviceRateLimitKey(
  deviceId: string,
  route: 'POST /api/recommend' | 'POST /api/ask',
): string {
  const shortRoute = route === 'POST /api/recommend' ? 'rec' : 'ask';
  return `dev_rl:${shortRoute}:${deviceId.trim()}`;
}

/**
 * Enforces per-device burst rate limits (Section 7.5, Section 8.7).
 * Atomically increments counter in `rate_limits` for the current minute window.
 * Throws RateLimitError when maximum threshold is exceeded.
 */
export async function consumeDeviceRateLimit(
  db: AppQueryDb,
  deviceId: string | null | undefined,
  route: 'POST /api/recommend' | 'POST /api/ask',
): Promise<void> {
  if (!deviceId || !deviceId.trim()) {
    return;
  }

  const maxAllowed =
    route === 'POST /api/recommend' ? DEVICE_RECOMMEND_RATE_LIMIT_MAX : DEVICE_ASK_RATE_LIMIT_MAX;

  const key = deviceRateLimitKey(deviceId, route);

  try {
    const rows = await db.execute<{ count: number }>(sql`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (
        ${key},
        date_trunc('minute', now()),
        1
      )
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING count;
    `);

    const currentCount = rows[0]?.count ?? 1;
    if (currentCount > maxAllowed) {
      throw new RateLimitError({
        limit: maxAllowed,
        current: currentCount,
        subject: 'device',
      });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    // Fail-open on transient database rate-limiting errors to prevent blocking legitimate traffic
  }
}

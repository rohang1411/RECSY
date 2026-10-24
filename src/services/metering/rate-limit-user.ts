import { RateLimitError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { PostgresRateLimitStore, incrementRateLimitStoreErrors } from '@/services/rate-limit/store';

const log = logger.child({ component: 'rate-limit-user' });

export const USER_RATE_LIMIT_WINDOW_MS = 60_000;
export const USER_RECOMMEND_RATE_LIMIT_MAX = 12;
export const USER_ASK_RATE_LIMIT_MAX = 20;
export const USER_READ_RATE_LIMIT_MAX = 60;

export type UserRateLimitRoute = 'recommend' | 'ask' | 'read';

export function userRateLimitKey(route: UserRateLimitRoute, userId: string): string {
  return `${route}:user:v1:${userId}`;
}

/**
 * Per-user rate limiter to prevent flooding across multiple IPs.
 * Normative reference: Section 7.5 and 7.8 of plan 25.
 *
 * Recommend: 12 requests / 60 seconds.
 * Ask: 20 requests / 60 seconds.
 * Read: 60 requests / 60 seconds.
 *
 * Fails open on transient database errors (rule R3).
 */
export async function consumeUserRateLimit(
  userId: string | null | undefined,
  route: UserRateLimitRoute,
  customDb?: AppQueryDb,
): Promise<void> {
  if (!userId) return;

  const windowMs = USER_RATE_LIMIT_WINDOW_MS;
  const maxAllowed =
    route === 'recommend'
      ? USER_RECOMMEND_RATE_LIMIT_MAX
      : route === 'ask'
        ? USER_ASK_RATE_LIMIT_MAX
        : USER_READ_RATE_LIMIT_MAX;

  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const key = userRateLimitKey(route, userId);
  const store = new PostgresRateLimitStore(customDb);

  try {
    const [outcome] = await store.consume(
      [{ key, windowMs, max: maxAllowed, subject: 'user' }],
      nowMs,
    );

    if (outcome?.limited) {
      throw new RateLimitError({
        windowStart: windowStart.toISOString(),
        route,
        maxAllowed,
        userId,
      });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route, userId }, 'rate_limit_store_error');
  }
}

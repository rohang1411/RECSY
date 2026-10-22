import { sql } from 'drizzle-orm';
import { RateLimitError } from '@/lib/errors';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { rateLimits } from '@/services/db/schema';

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
 */
export async function consumeUserRateLimit(
  userId: string | null | undefined,
  route: UserRateLimitRoute,
  customDb?: AppQueryDb,
): Promise<void> {
  if (!userId) return;

  const db = customDb ?? getDb();
  const windowMs = USER_RATE_LIMIT_WINDOW_MS;
  const maxAllowed =
    route === 'recommend'
      ? USER_RECOMMEND_RATE_LIMIT_MAX
      : route === 'ask'
        ? USER_ASK_RATE_LIMIT_MAX
        : USER_READ_RATE_LIMIT_MAX;

  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const key = userRateLimitKey(route, userId);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  if (count > maxAllowed) {
    throw new RateLimitError({
      windowStart: windowStart.toISOString(),
      route,
      maxAllowed,
      userId,
    });
  }
}

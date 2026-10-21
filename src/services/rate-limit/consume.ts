import { sql } from 'drizzle-orm';

import {
  ASK_RATE_LIMIT_MAX,
  ASK_RATE_LIMIT_WINDOW_MS,
  RECOMMEND_RATE_LIMIT_MAX,
  RECOMMEND_RATE_LIMIT_WINDOW_MS,
} from '@/lib/constants';
import { RateLimitError } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { rateLimits } from '@/services/db/schema';

import { hashClientIp } from './ip-hash';

export function askRateLimitKey(ipHash: string): string {
  return `ask:v1:${ipHash}`;
}

export function recommendRateLimitKey(ipHash: string): string {
  return `recommend:v1:${ipHash}`;
}

/**
 * Atomically increments the counter for this IP hash + time window.
 * Throws {@link RateLimitError} when the limit is exceeded after increment.
 */
export async function consumeAskRateLimit(clientIp: string): Promise<void> {
  const ipHash = hashClientIp(clientIp);
  const db = getDb();
  const windowMs = ASK_RATE_LIMIT_WINDOW_MS;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const key = askRateLimitKey(ipHash);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  if (count > ASK_RATE_LIMIT_MAX) {
    throw new RateLimitError({ windowStart: windowStart.toISOString() });
  }
}

/**
 * Rate limit for recommender intake — separate key prefix from `/api/ask`.
 */
export async function consumeRecommendRateLimit(clientIp: string): Promise<void> {
  const ipHash = hashClientIp(clientIp);
  const db = getDb();
  const windowMs = RECOMMEND_RATE_LIMIT_WINDOW_MS;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const key = recommendRateLimitKey(ipHash);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  if (count > RECOMMEND_RATE_LIMIT_MAX) {
    throw new RateLimitError({ windowStart: windowStart.toISOString() });
  }
}

export const BYOK_TEST_RATE_LIMIT_MAX = 10;
export const BYOK_TEST_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour (10 per hour per subject)

export function byokTestRateLimitKey(subjectKey: string): string {
  return `byok:test:v1:${subjectKey}`;
}

/**
 * Rate limit for BYOK validation test calls — 10 per hour per device/IP.
 */
export async function consumeByokTestRateLimit(subjectKey: string): Promise<void> {
  const db = getDb();
  const windowMs = BYOK_TEST_RATE_LIMIT_WINDOW_MS;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const key = byokTestRateLimitKey(subjectKey);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  if (count > BYOK_TEST_RATE_LIMIT_MAX) {
    throw new RateLimitError({ windowStart: windowStart.toISOString(), retryAfter: 3600 });
  }
}

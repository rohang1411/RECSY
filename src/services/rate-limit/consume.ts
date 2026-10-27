import {
  ASK_RATE_LIMIT_MAX,
  ASK_RATE_LIMIT_WINDOW_MS,
  RECOMMEND_RATE_LIMIT_MAX,
  RECOMMEND_RATE_LIMIT_WINDOW_MS,
} from '@/lib/constants';
import { RateLimitError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';

import { hashClientIp } from './ip-hash';
import { PostgresRateLimitStore, incrementRateLimitStoreErrors } from './store';

const log = logger.child({ component: 'rate-limit-consume' });

export function askRateLimitKey(ipHash: string): string {
  return `ask:v1:${ipHash}`;
}

export function recommendRateLimitKey(ipHash: string): string {
  return `recommend:v1:${ipHash}`;
}

/**
 * Atomically increments the counter for this IP hash + time window.
 * Throws {@link RateLimitError} when the limit is exceeded after increment.
 * Fails open on transient database errors (rule R3).
 */
export async function consumeAskRateLimit(clientIp: string, customDb?: AppQueryDb): Promise<void> {
  const ipHash = hashClientIp(clientIp);
  const windowMs = ASK_RATE_LIMIT_WINDOW_MS;
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const key = askRateLimitKey(ipHash);
  const store = new PostgresRateLimitStore(customDb);

  try {
    const [outcome] = await store.consume(
      [{ key, windowMs, max: ASK_RATE_LIMIT_MAX, subject: 'ip' }],
      nowMs,
    );
    if (outcome?.limited) {
      throw new RateLimitError({ windowStart: windowStart.toISOString() });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route: 'ask' }, 'rate_limit_store_error');
  }
}

/**
 * Rate limit for recommender intake — separate key prefix from `/api/ask`.
 */
export async function consumeRecommendRateLimit(
  clientIp: string,
  customDb?: AppQueryDb,
): Promise<void> {
  const ipHash = hashClientIp(clientIp);
  const windowMs = RECOMMEND_RATE_LIMIT_WINDOW_MS;
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const key = recommendRateLimitKey(ipHash);
  const store = new PostgresRateLimitStore(customDb);

  try {
    const [outcome] = await store.consume(
      [{ key, windowMs, max: RECOMMEND_RATE_LIMIT_MAX, subject: 'ip' }],
      nowMs,
    );
    if (outcome?.limited) {
      throw new RateLimitError({ windowStart: windowStart.toISOString() });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route: 'recommend' }, 'rate_limit_store_error');
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
export async function consumeByokTestRateLimit(
  subjectKey: string,
  customDb?: AppQueryDb,
): Promise<void> {
  const windowMs = BYOK_TEST_RATE_LIMIT_WINDOW_MS;
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const key = byokTestRateLimitKey(subjectKey);
  const store = new PostgresRateLimitStore(customDb);

  try {
    const [outcome] = await store.consume(
      [{ key, windowMs, max: BYOK_TEST_RATE_LIMIT_MAX, subject: 'ip' }],
      nowMs,
    );
    if (outcome?.limited) {
      throw new RateLimitError({ windowStart: windowStart.toISOString(), retryAfter: 3600 });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route: 'byok:test' }, 'rate_limit_store_error');
  }
}

export const CSP_REPORT_RATE_LIMIT_MAX = 30;
export const CSP_REPORT_RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

export function cspReportRateLimitKey(ipHash: string): string {
  return `csp_report:v1:${ipHash}`;
}

/**
 * Rate limit for CSP violation report receiver — 30 per minute per IP.
 */
export async function consumeCspReportRateLimit(
  clientIp: string,
  customDb?: AppQueryDb,
): Promise<void> {
  const ipHash = hashClientIp(clientIp);
  const windowMs = CSP_REPORT_RATE_LIMIT_WINDOW_MS;
  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const key = cspReportRateLimitKey(ipHash);
  const store = new PostgresRateLimitStore(customDb);

  try {
    const [outcome] = await store.consume(
      [{ key, windowMs, max: CSP_REPORT_RATE_LIMIT_MAX, subject: 'ip' }],
      nowMs,
    );
    if (outcome?.limited) {
      throw new RateLimitError({ windowStart: windowStart.toISOString(), retryAfter: 60 });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route: 'csp_report' }, 'rate_limit_store_error');
  }
}

export const SESSIONS_LIST_RATE_LIMIT_MAX = 60;
export const SESSIONS_LIST_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export const SESSIONS_DETAIL_RATE_LIMIT_MAX = 120;
export const SESSIONS_DETAIL_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export const SESSIONS_MUTATE_RATE_LIMIT_MAX = 30;
export const SESSIONS_MUTATE_RATE_LIMIT_WINDOW_MS = 60 * 1000;

export type SessionRateLimitRoute = 'sessions:list' | 'sessions:detail' | 'sessions:mutate';

export function sessionRateLimitKey(route: SessionRateLimitRoute, subject: string): string {
  return `${route}:v1:${subject}`;
}

/**
 * Rate limits for recommendation session endpoints (Plan 27 Section 9).
 * - sessions:list: 60/min
 * - sessions:detail: 120/min
 * - sessions:mutate: 30/min
 */
export async function consumeSessionRateLimit(
  route: SessionRateLimitRoute,
  subject: string,
  customDb?: AppQueryDb,
): Promise<void> {
  const windowMs =
    route === 'sessions:list'
      ? SESSIONS_LIST_RATE_LIMIT_WINDOW_MS
      : route === 'sessions:detail'
        ? SESSIONS_DETAIL_RATE_LIMIT_WINDOW_MS
        : SESSIONS_MUTATE_RATE_LIMIT_WINDOW_MS;

  const max =
    route === 'sessions:list'
      ? SESSIONS_LIST_RATE_LIMIT_MAX
      : route === 'sessions:detail'
        ? SESSIONS_DETAIL_RATE_LIMIT_MAX
        : SESSIONS_MUTATE_RATE_LIMIT_MAX;

  const nowMs = Date.now();
  const windowStart = new Date(Math.floor(nowMs / windowMs) * windowMs);
  const key = sessionRateLimitKey(route, subject);
  const store = new PostgresRateLimitStore(customDb);

  try {
    const [outcome] = await store.consume([{ key, windowMs, max, subject: 'ip' }], nowMs);
    if (outcome?.limited) {
      throw new RateLimitError({ windowStart: windowStart.toISOString(), retryAfter: 60 });
    }
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    incrementRateLimitStoreErrors();
    log.warn({ err, store: store.name, route }, 'rate_limit_store_error');
  }
}

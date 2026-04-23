/**
 * Cross-process rate limiter for ingestion adapters.
 *
 * Today's pipeline is run by GitHub Actions, which can schedule parallel
 * shards. An in-process limiter therefore isn't enough — two shards could
 * hammer `gsmarena.com` in tandem and trip Cloudflare. This module persists
 * the per-host "next allowed fetch time" in `rate_limit_state` so all
 * shards cooperate via UPSERT on the shared Supabase instance.
 *
 * The interface is small on purpose:
 *   await limiter.acquire('gsmarena.com'); // blocks until allowed, then
 *                                          // atomically reserves the slot
 *
 * Design notes:
 *   - We model "one request every `ratePerHostMs`" rather than a classic
 *     token-bucket. It fits the "polite crawler" shape (we want SPACING,
 *     not bursts) and is trivial to reason about.
 *   - The SQL is idempotent via `INSERT … ON CONFLICT DO UPDATE` with a
 *     conditional SET that only advances `next_allowed_at`.
 *   - If the DB is unreachable, we degrade to a local in-memory limiter
 *     rather than failing the whole adapter. A warning is logged.
 */
import { sql } from 'drizzle-orm';

import { logger } from '@/services/logger';

import type { Db } from './writer';

export interface RateLimiterOptions {
  /** Default min gap between requests to the same host (ms) if no override. */
  readonly defaultMs: number;
  /** Per-host overrides. Key is lowercase bare host (no scheme, no www.). */
  readonly perHostMs?: ReadonlyMap<string, number>;
  /**
   * How much to jitter each computed delay, as a fraction (0..1).
   * `0.4` = ±40%, uniform. Keeps crawl patterns less regular.
   */
  readonly jitter?: number;
  /**
   * Optional floor on `sleep()` durations to avoid busy-looping during
   * retry storms. Default 50ms.
   */
  readonly minSleepMs?: number;
}

export interface RateLimiter {
  /**
   * Block until it is this caller's turn to hit `host`, then reserve the
   * next slot by updating the shared state.
   */
  acquire(host: string): Promise<void>;
  /** Expose the last "next allowed at" computed for debugging / tests. */
  peek(host: string): Promise<Date | null>;
}

export function makeInMemoryLimiter(opts: RateLimiterOptions): RateLimiter {
  const map = new Map<string, number>();
  const jitter = opts.jitter ?? 0.4;
  const minSleepMs = opts.minSleepMs ?? 50;

  return {
    async acquire(host) {
      const h = normalizeHost(host);
      const now = Date.now();
      const nextAllowedAt = map.get(h) ?? 0;
      const gap = computeDelay(h, opts, jitter);
      if (now < nextAllowedAt) {
        await sleep(Math.max(minSleepMs, nextAllowedAt - now));
      }
      map.set(h, Date.now() + gap);
    },
    async peek(host) {
      const v = map.get(normalizeHost(host));
      return v ? new Date(v) : null;
    },
  };
}

/**
 * Build a limiter backed by the `rate_limit_state` table. Falls back to the
 * in-memory implementation if the DB call fails — we prefer "degrade to
 * less-cooperative" over "fail the crawl".
 */
export function makeDbLimiter(db: Db, opts: RateLimiterOptions): RateLimiter {
  const log = logger.child({ component: 'ingest.rate-limit' });
  const local = makeInMemoryLimiter(opts);
  const jitter = opts.jitter ?? 0.4;
  const minSleepMs = opts.minSleepMs ?? 50;

  return {
    async acquire(host) {
      const h = normalizeHost(host);
      const gapMs = computeDelay(h, opts, jitter);
      try {
        // Atomic: read `next_allowed_at`, sleep if future, then advance by
        // `gapMs` from max(now, next_allowed_at).
        //
        // We do it in two steps (read, then upsert) because Postgres'
        // `INSERT … RETURNING` gives us the resolved row. The race window
        // between steps is acceptable — worst case two shards briefly
        // double up; both will still be well below host capacity.
        const rows = await db.execute<{ next_allowed_at: string }>(sql`
          INSERT INTO rate_limit_state (host, window_start, req_count, next_allowed_at, updated_at)
          VALUES (${h}, now(), 1, now() + make_interval(secs => ${gapMs / 1000}), now())
          ON CONFLICT (host) DO UPDATE SET
            req_count = rate_limit_state.req_count + 1,
            next_allowed_at = GREATEST(rate_limit_state.next_allowed_at, now())
                              + make_interval(secs => ${gapMs / 1000}),
            updated_at = now()
          RETURNING next_allowed_at
        `);
        // The row we just wrote is the EARLIEST time the NEXT caller may
        // hit `host`; the time WE need to wait is (returned - gapMs).
        const reserved = rows[0];
        if (!reserved) return;
        const waitUntil = new Date(reserved.next_allowed_at).getTime() - gapMs;
        const now = Date.now();
        if (now < waitUntil) {
          await sleep(Math.max(minSleepMs, waitUntil - now));
        }
      } catch (err) {
        log.warn(
          { host: h, err: err instanceof Error ? err.message : String(err) },
          'rate_limit_state upsert failed; degrading to in-memory limiter',
        );
        await local.acquire(host);
      }
    },
    async peek(host) {
      try {
        const rows = await db.execute<{ next_allowed_at: string | null }>(
          sql`SELECT next_allowed_at FROM rate_limit_state WHERE host = ${normalizeHost(host)} LIMIT 1`,
        );
        const v = rows[0]?.next_allowed_at;
        return v ? new Date(v) : null;
      } catch {
        return local.peek(host);
      }
    },
  };
}

export function normalizeHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  // Strip scheme if a URL was passed by mistake.
  const stripped = trimmed.replace(/^https?:\/\//, '');
  // Strip leading www. — all domain-profile rows are stored bare.
  const bare = stripped.startsWith('www.') ? stripped.slice(4) : stripped;
  // Drop any path / query / port.
  return bare.split('/')[0]!.split(':')[0]!;
}

function computeDelay(host: string, opts: RateLimiterOptions, jitter: number): number {
  const base = opts.perHostMs?.get(host) ?? opts.defaultMs;
  if (jitter <= 0) return base;
  // Uniform jitter in [base*(1-j), base*(1+j)]. Math.random is fine here;
  // we don't need cryptographic entropy for politeness.
  const min = base * (1 - jitter);
  const max = base * (1 + jitter);
  return Math.floor(min + Math.random() * (max - min));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

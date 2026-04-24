/**
 * Polite HTTP layer for ingestion adapters.
 *
 * Every adapter that reaches the network goes through `PoliteHttp.fetch()`.
 * Doing so gives us five things ad-hoc `fetch()` calls can't:
 *
 *   1. Per-host rate limiting (via `rate-limit.ts`), shared across GitHub
 *      Actions shards through `rate_limit_state`.
 *   2. User-Agent rotation from a small self-identifying pool so we don't
 *      look like one noisy fingerprint hitting a host.
 *   3. robots.txt respect, cached per host for 24h in `domain_profiles`.
 *      Denied URLs throw `NotFoundError` so the orchestrator skips them.
 *   4. Honoring `Retry-After` headers on 429/503 instead of naive retries.
 *   5. Timeout + retry with exponential backoff via `p-retry`.
 *
 * Scope discipline (non-negotiable): GET only, public URLs only, no auth
 * flows, no login-wall bypasses. Legal rationale is in ADR 0014.
 */
import pRetry, { AbortError } from 'p-retry';

import { IntegrationError, NotFoundError } from '@/lib/errors';
import { logger } from '@/services/logger';

import {
  makeDbLimiter,
  makeInMemoryLimiter,
  normalizeHost,
  type RateLimiter,
  type RateLimiterOptions,
} from './rate-limit';
import type { Db } from './writer';

// Self-identifying User-Agents. Each variant points at the repo so a site
// operator can find us quickly if something goes wrong.
const USER_AGENTS: readonly string[] = [
  // Primary — canonical identification, the one used most often.
  'RECSYBot/0.1 (+https://github.com/rohan/recsy; contact: github issues) - review aggregation for non-commercial tooling',
  // Slightly different shape — still self-identifying. Rotation exists to
  // look less fingerprint-y, not to mask our identity.
  'RECSYBot/0.1 research build (+https://github.com/rohan/recsy)',
  'RECSYBot/0.1 portfolio-learning (+https://github.com/rohan/recsy; non-commercial)',
];

/** The contract adapters depend on. */
export interface PoliteHttp {
  /**
   * Polite GET with rate limiting, UA rotation, robots.txt respect, and
   * retries. Throws:
   *   - `NotFoundError` for 404 or robots-disallowed URLs (skip, don't retry).
   *   - `IntegrationError` for any other non-2xx after retries (retry next run).
   */
  get(url: string, opts?: HttpGetOptions): Promise<HttpResponse>;
  /**
   * True when robots.txt for the host allows GETting this URL with our UA.
   * Cached per host for 24h in the domain profile.
   */
  isAllowed(url: string): Promise<boolean>;
}

export interface HttpGetOptions {
  /** Override default timeout (20s). */
  readonly timeoutMs?: number;
  /** Additional request headers. `User-Agent`/`Accept-*` are supplied by default. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Bypass robots.txt check — reserved for robots.txt fetches themselves. */
  readonly bypassRobots?: boolean;
  /** Override retry count (default 3). */
  readonly retries?: number;
  /** Accept non-HTML bodies (e.g. XML for RSS). Default `text/html,application/xhtml+xml,application/xml`. */
  readonly accept?: string;
}

export interface HttpResponse {
  readonly url: string;
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

export interface PoliteHttpOptions {
  /** Optional DB — when supplied, limiter state is shared across shards. */
  readonly db?: Db;
  /** Per-host rate limit config (ms). If omitted, we use built-in defaults. */
  readonly rateLimitOptions?: RateLimiterOptions;
  /** For testing: a pool of UAs. Defaults to the built-in rotation. */
  readonly userAgents?: readonly string[];
  /** For testing: override `fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** For testing: deterministic random. */
  readonly random?: () => number;
}

/** Default built-in politeness (matches the plan and `domain_profiles` seed). */
export const DEFAULT_RATE_LIMIT_OPTIONS: RateLimiterOptions = {
  defaultMs: 3_000,
  perHostMs: new Map([
    ['gsmarena.com', 4_000],
    ['reddit.com', 2_000],
    ['youtube.com', 1_000],
    ['www.youtube.com', 1_000],
  ]),
  jitter: 0.4,
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

interface RobotsRecord {
  /** Parsed from `Disallow:` lines — lowercased path prefixes. */
  readonly disallow: readonly string[];
  readonly fetchedAt: number;
  /** Entire body for diagnostic purposes; not consulted on the hot path. */
  readonly raw: string;
}

export function makePoliteHttp(opts: PoliteHttpOptions = {}): PoliteHttp {
  const log = logger.child({ component: 'ingest.http' });
  const userAgents = opts.userAgents ?? USER_AGENTS;
  const rand = opts.random ?? Math.random;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const rateLimitOptions = opts.rateLimitOptions ?? DEFAULT_RATE_LIMIT_OPTIONS;
  const limiter: RateLimiter = opts.db
    ? makeDbLimiter(opts.db, rateLimitOptions)
    : makeInMemoryLimiter(rateLimitOptions);

  // In-process robots.txt cache. 24h TTL matches what we'd persist in
  // `domain_profiles.robots_fetched_at` (the DB-backed seed happens via the
  // domain-profiles seed and an optional refresh job; in-memory backs that
  // up so a single cron run doesn't re-fetch robots 10 times).
  const robotsCache = new Map<string, RobotsRecord>();
  const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

  function pickUa(): string {
    const idx = Math.floor(rand() * userAgents.length) % userAgents.length;
    return userAgents[idx]!;
  }

  async function fetchRobots(host: string): Promise<RobotsRecord> {
    const cached = robotsCache.get(host);
    if (cached && Date.now() - cached.fetchedAt < ROBOTS_TTL_MS) return cached;

    const url = `https://${host}/robots.txt`;
    try {
      await limiter.acquire(host);
      const res = await fetchImpl(url, {
        method: 'GET',
        headers: {
          'User-Agent': pickUa(),
          Accept: 'text/plain, */*;q=0.8',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        // No robots.txt == permissive per RFC 9309. Cache an empty record.
        const record: RobotsRecord = { disallow: [], fetchedAt: Date.now(), raw: '' };
        robotsCache.set(host, record);
        return record;
      }
      const raw = await res.text();
      const record: RobotsRecord = {
        disallow: parseRobotsDisallow(raw),
        fetchedAt: Date.now(),
        raw,
      };
      robotsCache.set(host, record);
      return record;
    } catch (err) {
      log.warn(
        { host, err: err instanceof Error ? err.message : String(err) },
        'robots.txt fetch failed; treating as permissive',
      );
      const record: RobotsRecord = { disallow: [], fetchedAt: Date.now(), raw: '' };
      robotsCache.set(host, record);
      return record;
    }
  }

  async function isAllowed(url: string): Promise<boolean> {
    const parsed = safeUrl(url);
    if (!parsed) return false;
    const host = normalizeHost(parsed.host);
    const robots = await fetchRobots(host);
    const path = parsed.pathname + (parsed.search ?? '');
    return !robots.disallow.some((prefix) => prefix !== '' && path.startsWith(prefix));
  }

  return {
    async get(url, options = {}) {
      const parsed = safeUrl(url);
      if (!parsed) {
        throw new NotFoundError(`invalid URL: ${url}`, { url });
      }
      const host = normalizeHost(parsed.host);

      if (!options.bypassRobots) {
        const allowed = await isAllowed(url);
        if (!allowed) {
          throw new NotFoundError('robots.txt disallowed', { url, host });
        }
      }

      const retries = options.retries ?? 3;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

      return await pRetry(
        async () => {
          await limiter.acquire(host);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const res = await fetchImpl(url, {
              method: 'GET',
              headers: {
                'User-Agent': pickUa(),
                Accept: options.accept ?? DEFAULT_ACCEPT,
                'Accept-Language': 'en;q=0.9',
                ...(options.headers ?? {}),
              },
              redirect: 'follow',
              signal: controller.signal,
            });

            if (res.status === 404 || res.status === 410) {
              // Permanent — don't retry.
              throw new AbortError(new NotFoundError(`HTTP ${res.status} ${url}`, { url }));
            }
            if (res.status === 429 || res.status === 503) {
              // Honour Retry-After when present.
              const ra = res.headers.get('retry-after');
              const waitMs = parseRetryAfter(ra);
              if (waitMs > 0) {
                await new Promise((r) => setTimeout(r, Math.min(waitMs, 30_000)));
              }
              throw new IntegrationError(`HTTP ${res.status} ${url}`, {
                url,
                retryAfter: ra,
              });
            }
            if (!res.ok) {
              throw new IntegrationError(`HTTP ${res.status} ${url}`, { url, status: res.status });
            }
            const body = await res.text();
            return { url, status: res.status, body, headers: res.headers } satisfies HttpResponse;
          } finally {
            clearTimeout(timeout);
          }
        },
        {
          retries,
          minTimeout: 1_000,
          factor: 2,
          randomize: true,
          onFailedAttempt: (err: any) => {
            log.warn(
              { url, attempt: err.attemptNumber, err: err.message },
              'http get failed; will retry',
            );
          },
        },
      );
    },
    isAllowed,
  };
}

/**
 * Minimal robots.txt parser:
 *   - Only cares about our groups (User-agent: * and User-agent: RECSYBot*).
 *   - Collects `Disallow:` paths (empty `Disallow:` is permissive, per spec).
 *   - Ignores `Allow:` lines; we follow the conservative interpretation that
 *     a Disallow in our group => path is denied. Sites that wanted fine-grained
 *     control would use a specific user agent anyway.
 */
export function parseRobotsDisallow(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const results = new Set<string>();
  let inOurGroup = false;
  // The current group starts at a "User-agent:" line and ends at the next.
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) {
      inOurGroup = false;
      continue;
    }
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();

    if (key === 'user-agent') {
      const v = value.toLowerCase();
      inOurGroup = v === '*' || v.startsWith('recsybot');
      continue;
    }
    if (inOurGroup && key === 'disallow') {
      if (value.length > 0) results.add(value);
    }
  }
  return Array.from(results);
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 0;
  // Numeric seconds.
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n * 1_000);
  // HTTP-date.
  const ms = Date.parse(header);
  if (Number.isFinite(ms)) {
    const delta = ms - Date.now();
    return delta > 0 ? delta : 0;
  }
  return 0;
}

function safeUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

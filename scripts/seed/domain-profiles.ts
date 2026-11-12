/**
 * Seed `domain_profiles` — per-host crawl configuration. Adapters go through
 * `src/services/ingest/http.ts`, which reads these rows to decide:
 *   - rate limit (min gap between consecutive requests to the same host)
 *   - trust weight (input to the Curator's quality gate)
 *   - whether we consult robots.txt before fetching
 *
 * Add a new host here when you enable an adapter against it. Hosts NOT in
 * this table fall back to a conservative default (1 req / 3 s, trust 0.5).
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { domainProfiles } from '../../src/services/db/schema';

export interface DomainSeed {
  host: string;
  trustWeight: string;
  rateLimitMs: number;
  robotsRespected: boolean;
  rssFeedUrl?: string;
  notes?: string;
}

export const DOMAIN_SEEDS: readonly DomainSeed[] = [
  // Primary target — GSMArena has both news and review sections.
  {
    host: 'gsmarena.com',
    trustWeight: '0.92',
    rateLimitMs: 4_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.gsmarena.com/rss-news-reviews.php3',
    notes: 'Primary spec + review source. Cloudflare-sensitive; stay under 1 req/4s.',
  },
  {
    host: 'reddit.com',
    trustWeight: '0.70',
    rateLimitMs: 2_000,
    robotsRespected: true,
    notes: 'Public JSON endpoints; keep UA self-identifying to avoid 429s.',
  },
  {
    host: 'youtube.com',
    trustWeight: '0.85',
    rateLimitMs: 1_000,
    robotsRespected: true,
    notes: 'Innertube + RSS + timedtext. Transcript endpoint is datacenter-sensitive.',
  },

  // Editorial sources with RSS endpoints for continuous discovery
  {
    host: 'androidauthority.com',
    trustWeight: '0.90',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.androidauthority.com/reviews/feed/',
    notes: 'Dedicated review feed with frequent 6-month & 1-year retrospective writeups.',
  },
  {
    host: 'theverge.com',
    trustWeight: '0.90',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.theverge.com/rss/reviews/index.xml',
    notes: 'High cultural reach; rigorous review scores and hardware assessments.',
  },
  {
    host: 'tomsguide.com',
    trustWeight: '0.85',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.tomsguide.com/feeds/all',
    notes: 'Standardized lab battery tests and nit brightness measurements.',
  },
  {
    host: '9to5google.com',
    trustWeight: '0.88',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://9to5google.com/feed/',
    notes: 'Deep Android and Pixel long-term coverage, monthly feature drop reviews.',
  },
  {
    host: '9to5mac.com',
    trustWeight: '0.88',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://9to5mac.com/feed/',
    notes: 'Dedicated iPhone long-term hardware testing, iOS battery drain logs.',
  },
  {
    host: 'arstechnica.com',
    trustWeight: '0.92',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://feeds.arstechnica.com/arstechnica/reviews',
    notes: 'Deep silicon architecture analysis, Linux kernel changes, display tech.',
  },
  {
    host: 'notebookcheck.net',
    trustWeight: '0.92',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.notebookcheck.net/News.152.0.rss',
    notes: 'PWM frequency, thermal camera imaging, sustained benchmark throttling.',
  },
  {
    host: 'techradar.com',
    trustWeight: '0.85',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.techradar.com/rss/reviews',
    notes: 'Broad smartphone category coverage across global regions.',
  },
  {
    host: 'digitaltrends.com',
    trustWeight: '0.82',
    rateLimitMs: 3_000,
    robotsRespected: true,
    rssFeedUrl: 'https://www.digitaltrends.com/feed/',
    notes: 'Practical buying advice, long-term durability follow-ups.',
  },
  { host: 'androidpolice.com', trustWeight: '0.80', rateLimitMs: 3_000, robotsRespected: true },
  { host: 'engadget.com', trustWeight: '0.80', rateLimitMs: 3_000, robotsRespected: true },
  { host: 'dxomark.com', trustWeight: '0.85', rateLimitMs: 3_000, robotsRespected: true },
  { host: 'wired.com', trustWeight: '0.85', rateLimitMs: 3_000, robotsRespected: true },
  { host: 'cnet.com', trustWeight: '0.70', rateLimitMs: 3_000, robotsRespected: true },
];

export async function seedDomainProfiles(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<{ upserted: number }> {
  if (DOMAIN_SEEDS.length === 0) return { upserted: 0 };
  const rows = DOMAIN_SEEDS.map((s) => ({
    host: s.host.toLowerCase(),
    trustWeight: s.trustWeight,
    rateLimitMs: s.rateLimitMs,
    robotsRespected: s.robotsRespected,
    rssFeedUrl: s.rssFeedUrl ?? null,
    status: 'active' as const,
  }));
  const result = await db
    .insert(domainProfiles)
    .values(rows)
    .onConflictDoUpdate({
      target: domainProfiles.host,
      set: {
        trustWeight: sql`excluded.trust_weight`,
        rateLimitMs: sql`excluded.rate_limit_ms`,
        robotsRespected: sql`excluded.robots_respected`,
        rssFeedUrl: sql`excluded.rss_feed_url`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: domainProfiles.id });
  return { upserted: result.length };
}

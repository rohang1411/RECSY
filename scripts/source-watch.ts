#!/usr/bin/env tsx
/**
 * source-watch.ts — Continuous Multi-Platform Source Scout (Plan 29 WP-02).
 *
 * Runs every 6 hours via GitHub Actions (`.github/workflows/source-watch.yml`).
 *
 * Concurrently polls:
 *   1. 36 Verified YouTube Creator RSS feeds
 *   2. 10 Curated Tech Publication Editorial RSS feeds
 *
 * Characteristics:
 *   - Metadata-only, zero LLM calls, zero expensive scrapers.
 *   - Fast XML parsing with error-resilient regexes.
 *   - Longest-match-wins alias matching against phone_aliases.
 *   - Automatic temporal categorization (launch, long_term_6m, long_term_1y, comparison).
 *   - Pre-deduplication against `sources` and `crawl_queue`.
 *   - Autonomous new phone candidate staging (preserves creator-watch scout).
 *
 * Usage:
 *   pnpm exec tsx scripts/source-watch.ts [--dry-run] [--max-candidates N]
 */
import { eq, inArray, sql } from 'drizzle-orm';

import { summarizeErrorChainForLogs } from '../src/lib/summarize-error';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import {
  catalogCandidates,
  crawlQueue,
  creatorProfiles,
  domainProfiles,
  phones,
  sources,
} from '../src/services/db/schema';
import { buildCanonicalKey } from '../src/services/catalog';
import {
  extractCandidatePhonesFromTitle,
  makeDbAliasLoader,
  matchAliases,
} from '../src/services/ingest';
import { logger } from '../src/services/logger';

interface CliArgs {
  readonly dryRun: boolean;
  readonly maxCandidates: number;
}

interface DiscoveredEntry {
  readonly platform: 'youtube' | 'article';
  readonly url: string;
  readonly title: string;
  readonly publishedAt: Date | null;
  readonly channelOrHost: string;
  readonly videoId?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, maxCandidates: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      (args as { dryRun: boolean }).dryRun = true;
    } else if (a === '--max-candidates') {
      (args as { maxCandidates: number }).maxCandidates = Number(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      console.log('Usage: pnpm exec tsx scripts/source-watch.ts [--dry-run] [--max-candidates N]');
      process.exit(0);
    }
  }
  return args;
}

export async function pollYouTubeRss(
  channelId: string,
  handle: string,
): Promise<DiscoveredEntry[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return [];
    const xml = await res.text();
    const entries: DiscoveredEntry[] = [];
    const entryRx = /<entry>([\s\S]*?)<\/entry>/gi;
    let m: RegExpExecArray | null;
    while ((m = entryRx.exec(xml)) != null) {
      const block = m[1]!;
      const vidMatch = /<yt:videoId>(.*?)<\/yt:videoId>/i.exec(block);
      const titleMatch = /<title>(.*?)<\/title>/i.exec(block);
      const pubMatch = /<published>(.*?)<\/published>/i.exec(block);
      if (vidMatch && titleMatch) {
        entries.push({
          platform: 'youtube',
          url: `https://www.youtube.com/watch?v=${vidMatch[1]!.trim()}`,
          videoId: vidMatch[1]!.trim(),
          title: titleMatch[1]!
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .trim(),
          publishedAt: pubMatch ? new Date(pubMatch[1]!.trim()) : null,
          channelOrHost: handle,
        });
      }
    }
    return entries;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function pollEditorialRss(feedUrl: string, host: string): Promise<DiscoveredEntry[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(feedUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'RECSYBot/1.0 (+https://recsy.app/bot; editorial review aggregator)',
        Accept: 'application/rss+xml, application/atom+xml, text/xml',
      },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    const entries: DiscoveredEntry[] = [];
    const itemRx = /<(?:item|entry)>([\s\S]*?)<\/(?:item|entry)>/gi;
    let m: RegExpExecArray | null;
    while ((m = itemRx.exec(xml)) != null) {
      const block = m[1]!;
      const linkMatch = /<link(?: rel="alternate")?(?: href="([^"]+)"|>(.*?)<\/link>)/i.exec(block);
      const titleMatch = /<title(?:[^>]*)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i.exec(block);
      const pubMatch =
        /<(?:pubDate|published|updated)>(.*?)<\/(?:pubDate|published|updated)>/i.exec(block);
      const url = (linkMatch?.[1] || linkMatch?.[2])?.trim();
      const title = titleMatch?.[1]
        ?.replace(/&amp;/g, '&')
        .replace(/<!\[CDATA\[|\]\]>/g, '')
        .trim();
      if (url && title && url.startsWith('http')) {
        entries.push({
          platform: 'article',
          url,
          title,
          publishedAt: pubMatch ? new Date(pubMatch[1]!.trim()) : null,
          channelOrHost: host,
        });
      }
    }
    return entries;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function classifyTemporalCategory(
  title: string,
  matchCount: number,
): 'launch' | 'long_term_6m' | 'long_term_1y' | 'comparison' | 'general' {
  const lower = title.toLowerCase();
  if (
    lower.includes('6 month') ||
    lower.includes('3 month') ||
    lower.includes('long term') ||
    lower.includes('long-term')
  ) {
    return 'long_term_6m';
  }
  if (
    lower.includes('1 year') ||
    lower.includes('one year') ||
    lower.includes('revisited') ||
    lower.includes('still worth')
  ) {
    return 'long_term_1y';
  }
  if (
    lower.includes(' vs ') ||
    lower.includes(' versus ') ||
    lower.includes('compared') ||
    matchCount >= 2
  ) {
    return 'comparison';
  }
  if (
    lower.includes('review') ||
    lower.includes('camera test') ||
    lower.includes('battery test') ||
    lower.includes('unboxing')
  ) {
    return 'launch';
  }
  return 'general';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const log = logger.child({ script: 'source-watch' });

  const missing = await findMissingPublicSchema(db, [
    { table: 'phones' },
    { table: 'phone_aliases' },
    { table: 'creator_profiles' },
    { table: 'domain_profiles' },
    { table: 'crawl_queue' },
    { table: 'sources' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('source-watch', missing));
    process.exit(0);
  }

  const aliasLoader = makeDbAliasLoader(db);
  const aliases = await aliasLoader();

  log.info('Polite source-watch starting across YouTube creators & tech publications...');

  // 1. Fetch active creator and domain profiles
  const creatorRows = await db
    .select({
      externalId: creatorProfiles.externalId,
      handle: creatorProfiles.handle,
      platform: creatorProfiles.platform,
    })
    .from(creatorProfiles)
    .where(eq(creatorProfiles.status, 'active'));

  const domainRows = await db
    .select({ host: domainProfiles.host, rssFeedUrl: domainProfiles.rssFeedUrl })
    .from(domainProfiles)
    .where(eq(domainProfiles.status, 'active'));

  // 2. Concurrently poll all RSS feeds
  const pollTasks: Array<Promise<DiscoveredEntry[]>> = [];
  for (const c of creatorRows) {
    if (c.platform === 'youtube') {
      pollTasks.push(pollYouTubeRss(c.externalId, c.handle));
    }
  }
  for (const d of domainRows) {
    if (d.rssFeedUrl) {
      pollTasks.push(pollEditorialRss(d.rssFeedUrl, d.host));
    }
  }

  const results = await Promise.allSettled(pollTasks);
  const discovered: DiscoveredEntry[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') discovered.push(...r.value);
  }

  log.info({ totalEntriesScanned: discovered.length }, 'RSS feeds successfully harvested');

  // 3. Match titles against known phone aliases
  interface EnqueueCandidate {
    readonly phoneId: string;
    readonly adapter: 'youtube' | 'article';
    readonly url: string;
    readonly title: string;
    readonly temporalCategory:
      | 'launch'
      | 'long_term_6m'
      | 'long_term_1y'
      | 'comparison'
      | 'general';
  }

  const candidates: EnqueueCandidate[] = [];
  for (const item of discovered) {
    const hits = matchAliases(item.title, aliases);
    if (hits.length === 0) continue;

    const temporalCategory = classifyTemporalCategory(item.title, hits.length);

    for (const hit of hits) {
      candidates.push({
        phoneId: hit.phoneId,
        adapter: item.platform,
        url: item.url,
        title: item.title,
        temporalCategory,
      });
    }
  }

  log.info({ matchedCandidates: candidates.length }, 'Phone aliases matched on RSS candidates');

  // 4. Batch pre-deduplication against `crawl_queue` AND `sources`
  let enqueuedCount = 0;
  if (candidates.length > 0) {
    const distinctUrls = [...new Set(candidates.map((c) => c.url))];

    // Check crawl_queue
    const existingQueue = await db
      .select({ url: crawlQueue.url, phoneId: crawlQueue.phoneId })
      .from(crawlQueue)
      .where(inArray(crawlQueue.url, distinctUrls));
    const seenInQueue = new Set(existingQueue.map((r) => `${r.phoneId}:${r.url}`));

    // Check sources
    const existingSources = await db
      .select({ url: sources.url, phoneId: sources.phoneId })
      .from(sources)
      .where(inArray(sources.url, distinctUrls));
    const seenInSources = new Set(existingSources.map((r) => `${r.phoneId}:${r.url}`));

    const rowsToInsert = candidates
      .filter(
        (c) =>
          !seenInQueue.has(`${c.phoneId}:${c.url}`) && !seenInSources.has(`${c.phoneId}:${c.url}`),
      )
      .slice(0, args.maxCandidates * 10)
      .map((c) => ({
        phoneId: c.phoneId,
        adapter: c.adapter,
        url: c.url,
        tier: 'hot' as const,
        status: 'queued' as const,
        temporalCategory: c.temporalCategory,
        scheduledFor: new Date(),
        attempts: 0,
      }));

    if (args.dryRun) {
      console.log(`[source-watch:dry-run] Would enqueue ${rowsToInsert.length} items:`);
      for (const row of rowsToInsert) {
        console.log(`  - [${row.temporalCategory}] ${row.adapter}: ${row.url}`);
      }
    } else if (rowsToInsert.length > 0) {
      await db.insert(crawlQueue).values(rowsToInsert);
      enqueuedCount = rowsToInsert.length;
      log.info({ enqueuedCount }, 'Successfully enqueued fresh sources into crawl_queue');
    }
  }

  // 5. Autonomous Discovery Scout for uncataloged new phones (preserves creator-watch scout)
  let stagedNewCandidates = 0;
  try {
    const existingPhones = await db
      .select({ slug: phones.slug, canonicalKey: phones.canonicalKey })
      .from(phones)
      .where(sql`${phones.status} in ('active', 'upcoming')`);
    const existingSlugs = new Set(existingPhones.map((p) => p.slug));
    const existingPhoneKeys = new Set(
      existingPhones.map((p) => p.canonicalKey).filter((k): k is string => Boolean(k)),
    );

    const existingCandidates = await db
      .select({
        canonicalKey: catalogCandidates.canonicalKey,
        stableKey: catalogCandidates.stableKey,
      })
      .from(catalogCandidates);
    const candidateKeys = new Set(
      existingCandidates.map((c) => c.canonicalKey).filter((k): k is string => Boolean(k)),
    );
    const stableKeys = new Set(existingCandidates.map((c) => c.stableKey));

    for (const item of discovered) {
      if (item.platform !== 'youtube') continue;
      const found = extractCandidatePhonesFromTitle(
        item.title,
        item.publishedAt ? item.publishedAt.toISOString() : undefined,
      );
      for (const f of found) {
        const canonicalKey = buildCanonicalKey({
          brand: f.brand,
          model: f.model,
          launchDate: String(f.year),
        });
        const slug = `${f.brand.toLowerCase()}-${f.model.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

        if (existingSlugs.has(slug) || existingPhoneKeys.has(canonicalKey)) continue;
        if (candidateKeys.has(canonicalKey)) continue;

        const stableKey = `creator_watch:${canonicalKey}`;
        if (stableKeys.has(stableKey)) continue;

        if (args.dryRun) {
          console.log(
            `  [discovered-new-phone] ${f.brand} ${f.model} (${canonicalKey}) from ${item.channelOrHost}: ${item.title}`,
          );
          stagedNewCandidates++;
          continue;
        }

        await db
          .insert(catalogCandidates)
          .values({
            stableKey,
            sourceKey: 'creator_watch',
            sourceType: 'youtube',
            externalId: item.videoId ?? item.url,
            sourceUrl: item.url,
            candidateTitle: `${f.brand} ${f.model}`,
            rawCandidateJson: {
              title: item.title,
              url: item.url,
              videoId: item.videoId,
              publishedAt: item.publishedAt?.toISOString(),
              creatorHandle: item.channelOrHost,
              launchDate: `${f.year}-09-01`,
            },
            normalizedIdentityJson: {
              brand: f.brand,
              model: f.model,
              launchDate: `${f.year}-09-01`,
              aliases: [`${f.brand} ${f.model}`],
            },
            canonicalKey,
            decision: 'pending_review',
            status: 'discovered',
            confidence: '0.85',
            claimsJson: {
              brand: f.brand,
              model: f.model,
              title: item.title,
              videoUrl: item.url,
              creatorHandle: item.channelOrHost,
              publishedAt: item.publishedAt?.toISOString(),
              discoveredAt: new Date().toISOString(),
            },
          })
          .onConflictDoNothing();

        candidateKeys.add(canonicalKey);
        stableKeys.add(stableKey);
        stagedNewCandidates++;
      }
    }
  } catch (scoutErr) {
    log.warn(
      { err: summarizeErrorChainForLogs(scoutErr) },
      'Autonomous scout encountered non-fatal error',
    );
  }

  // Update last_polled_at timestamps on creator_profiles
  try {
    await db
      .update(creatorProfiles)
      .set({ lastPolledAt: new Date() })
      .where(eq(creatorProfiles.status, 'active'));
  } catch {}

  console.log(
    `[source-watch] done: ${discovered.length} items scanned across 36 YT channels + 10 publications. ` +
      `Enqueued: ${enqueuedCount}. New uncataloged phones staged: ${stagedNewCandidates}.`,
  );
  process.exit(0);
}

if (process.argv[1]?.endsWith('source-watch.ts') || process.argv[1]?.includes('source-watch')) {
  main().catch((err) => {
    console.error('[source-watch] Fatal error:', err);
    process.exit(1);
  });
}

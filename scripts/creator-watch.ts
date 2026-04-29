#!/usr/bin/env tsx
/**
 * Creator-watch — metadata-only refresh of RSS feeds.
 *
 * Every 6 hours we want to notice when a watched channel (MKBHD etc.) drops
 * a new video, but we don't want to pay the cost of a full transcript +
 * embedding run each time. This script:
 *
 *   1. Pulls the creator_profiles allowlist (platform=youtube, status=active).
 *   2. Fetches each RSS feed through the polite HTTP wrapper.
 *   3. For each entry, heuristically matches against phone_aliases.
 *   4. Inserts metadata-only rows into `crawl_queue` with tier=hot (the
 *      scheduler's next tiered run will pick them up and do the heavy work).
 *
 * Fast to run (~tens of seconds) and cheap in GH Actions minutes. Safe to
 * run concurrently with `ingest-auto.ts` — they don't touch the same rows.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { summarizeErrorChainForLogs } from '../src/lib/summarize-error';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { crawlQueue, creatorProfiles, phones } from '../src/services/db/schema';
import {
  makeDbAliasLoader,
  makePoliteHttp,
  YouTubeChannelAdapter,
  type CreatorChannel,
} from '../src/services/ingest';
import { logger } from '../src/services/logger';

interface CliArgs {
  readonly dryRun: boolean;
  readonly maxCandidates: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { dryRun: false, maxCandidates: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') {
      (args as { dryRun: boolean }).dryRun = true;
    } else if (a === '--max-candidates') {
      (args as { maxCandidates: number }).maxCandidates = Number(argv[++i]);
    } else if (a === '-h' || a === '--help') {
      console.log('Usage: pnpm creator:watch [--dry-run] [--max-candidates N]');
      process.exit(0);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const missing = await findMissingPublicSchema(db, [
    { table: 'phones' },
    { table: 'phone_aliases' },
    { table: 'creator_profiles' },
    { table: 'crawl_queue' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('creator-watch', missing));
    process.exit(0);
  }

  const http = makePoliteHttp({ db });
  const aliasLoader = makeDbAliasLoader(db);
  const aliases = await aliasLoader();

  const creatorRows = await db
    .select({
      externalId: creatorProfiles.externalId,
      handle: creatorProfiles.handle,
      platform: creatorProfiles.platform,
      status: creatorProfiles.status,
    })
    .from(creatorProfiles);

  const creators: CreatorChannel[] = creatorRows
    .filter((r) => r.status === 'active' && r.platform === 'youtube')
    .map((r) => ({ handle: r.handle, channelId: r.externalId }));

  if (creators.length === 0) {
    console.log('[creator-watch] no active YouTube creators configured');
    process.exit(0);
  }

  const adapter = new YouTubeChannelAdapter({ http, creators, aliases });

  const phoneRows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
    })
    .from(phones);

  let totalCandidates = 0;
  let totalEnqueued = 0;

  for (const phone of phoneRows) {
    try {
      const candidates = await adapter.discover(
        {
          id: phone.id,
          slug: phone.slug,
          brand: phone.brand,
          model: phone.model,
          launchDate: phone.launchDate ? phone.launchDate.toISOString().slice(0, 10) : null,
        },
        { limit: args.maxCandidates },
      );
      totalCandidates += candidates.length;

      if (candidates.length === 0) continue;

      if (args.dryRun) {
        for (const c of candidates) {
          console.log(`  ${phone.slug}  ${c.url}  (${c.title})`);
        }
        continue;
      }

      // Dedup against URLs already in the queue for this phone.
      const urls = candidates.map((c) => c.url);
      const existing = await db
        .select({ url: crawlQueue.url })
        .from(crawlQueue)
        .where(and(eq(crawlQueue.phoneId, phone.id), inArray(crawlQueue.url, urls)));
      const seen = new Set(existing.map((r) => r.url));

      const rowsToInsert = candidates
        .filter((c) => !seen.has(c.url))
        .map((c) => ({
          phoneId: phone.id,
          adapter: 'youtube',
          url: c.url,
          tier: 'hot' as const,
          status: 'queued' as const,
          scheduledFor: new Date(),
          attempts: 0,
        }));
      if (rowsToInsert.length > 0) {
        await db.insert(crawlQueue).values(rowsToInsert);
        totalEnqueued += rowsToInsert.length;
      }
    } catch (err) {
      logger.warn(
        { phone: phone.slug, err: err instanceof Error ? err.message : String(err) },
        'creator-watch: discovery failed',
      );
    }
  }

  // Touch creator_profiles.last_polled_at so the UI/reports reflect freshness.
  if (!args.dryRun) {
    for (const c of creatorRows) {
      await db
        .update(creatorProfiles)
        .set({ lastPolledAt: new Date(), updatedAt: sql`now()` })
        .where(eq(creatorProfiles.externalId, c.externalId));
    }
  }

  console.log(
    `[creator-watch] done phones=${phoneRows.length} candidates=${totalCandidates} enqueued=${totalEnqueued}${args.dryRun ? ' (dry-run)' : ''}`,
  );
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err: summarizeErrorChainForLogs(err) }, 'creator-watch crashed');
  console.error('[creator-watch] FAILED');
  console.error(summarizeErrorChainForLogs(err));
  process.exit(1);
});

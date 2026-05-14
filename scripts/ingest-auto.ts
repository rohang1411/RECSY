#!/usr/bin/env tsx
/**
 * Automated (tiered) ingestion entrypoint.
 *
 * Unlike `scripts/ingest.ts` which is interactive (`--phone <slug>`), this
 * script is designed for cron / GitHub Actions: it picks the set of phones
 * that are "due" based on `next_ingest_at`, honours freshness tiers, and
 * runs all relevant adapters with the Curator + Disambiguator wired in.
 *
 * Usage (local smoke-test):
 *   pnpm ingest:auto --tier hot --limit 5 --dry-run
 *
 * Usage (GitHub Actions, sharded):
 *   pnpm ingest:auto --tier hot --shard 0 --total-shards 4
 *
 * Exit codes:
 *   0 — at least one phone was processed (even with some per-source errors).
 *   1 — uncaught crash or every phone failed.
 *   2 — bad arguments.
 */
import { getDb } from '../src/services/db/client';
import { summarizeErrorChainForLogs } from '../src/lib/summarize-error';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { phones } from '../src/services/db/schema';
import {
  ArticleAdapter,
  GsmArenaAdapter,
  IngestOrchestrator,
  RedditAdapter,
  YouTubeChannelAdapter,
  makeDbAliasLoader,
  makeDbPhoneLookup,
  makePoliteHttp,
  markIngested,
  pickPhones,
  type IngestTier,
  type CreatorChannel,
  type SubredditProfile,
} from '../src/services/ingest';
import { getLlm } from '../src/services/llm';
import { logger } from '../src/services/logger';
import { creatorProfiles, subredditProfiles } from '../src/services/db/schema';

interface CliArgs {
  tier: IngestTier | 'all';
  limit: number;
  dryRun: boolean;
  shard: number;
  totalShards: number;
  /** Per-phone, per-adapter discovery limit. */
  perPhoneLimit: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: Partial<CliArgs> = {
    tier: 'all',
    limit: 25,
    dryRun: false,
    shard: 0,
    totalShards: 1,
    perPhoneLimit: 5,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--tier': {
        const v = argv[++i];
        if (v !== 'hot' && v !== 'warm' && v !== 'cold' && v !== 'all') {
          exitWithUsage(`Invalid --tier: ${v}`);
        }
        args.tier = v;
        break;
      }
      case '--limit':
        args.limit = Number(argv[++i]);
        if (!Number.isFinite(args.limit) || args.limit <= 0) {
          exitWithUsage('Invalid --limit');
        }
        break;
      case '--per-phone-limit':
        args.perPhoneLimit = Number(argv[++i]);
        if (!Number.isFinite(args.perPhoneLimit) || args.perPhoneLimit <= 0) {
          exitWithUsage('Invalid --per-phone-limit');
        }
        break;
      case '--shard':
        args.shard = Number(argv[++i]);
        if (!Number.isFinite(args.shard) || args.shard < 0) {
          exitWithUsage('Invalid --shard');
        }
        break;
      case '--total-shards':
        args.totalShards = Number(argv[++i]);
        if (!Number.isFinite(args.totalShards) || args.totalShards <= 0) {
          exitWithUsage('Invalid --total-shards');
        }
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '-h':
      case '--help':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${a}`);
    }
  }
  if ((args.shard ?? 0) >= (args.totalShards ?? 1)) {
    exitWithUsage('--shard must be < --total-shards');
  }
  return args as CliArgs;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm ingest:auto [options]',
      '',
      'Options:',
      '  --tier hot|warm|cold|all   Restrict to a tier (default: all)',
      '  --limit N                  Max phones to process in this run (default: 25)',
      '  --per-phone-limit N        Max candidates per adapter per phone (default: 5)',
      '  --shard K                  Shard index (0-based, default: 0)',
      '  --total-shards N           Total shards (default: 1)',
      '  --dry-run                  Discover + fetch + chunk, skip embed/write',
      '  --help                     Print this message',
    ].join('\n'),
  );
}

function exitWithUsage(msg: string): never {
  console.error(`[ingest:auto] ${msg}\n`);
  printUsage();
  process.exit(2);
}

async function loadCreatorProfiles(db: ReturnType<typeof getDb>): Promise<CreatorChannel[]> {
  const rows = await db
    .select({
      platform: creatorProfiles.platform,
      externalId: creatorProfiles.externalId,
      handle: creatorProfiles.handle,
      trustWeight: creatorProfiles.trustWeight,
      status: creatorProfiles.status,
    })
    .from(creatorProfiles);
  return rows
    .filter((r) => r.status === 'active' && r.platform === 'youtube')
    .map((r) => ({
      handle: r.handle,
      channelId: r.externalId,
      trustWeight: r.trustWeight ? Number(r.trustWeight) : undefined,
    }));
}

async function loadSubredditProfiles(db: ReturnType<typeof getDb>): Promise<SubredditProfile[]> {
  const rows = await db
    .select({
      name: subredditProfiles.name,
      scope: subredditProfiles.scope,
      minScore: subredditProfiles.minScore,
      status: subredditProfiles.status,
    })
    .from(subredditProfiles);
  return rows
    .filter((r) => r.status === 'active')
    .map((r) => ({
      name: r.name,
      scope: r.scope === 'device' ? 'device' : 'general',
      minScore: r.minScore ?? 20,
    }));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'phones', columns: ['next_ingest_at', 'last_ingest_at'] },
    { table: 'phone_aliases' },
    { table: 'creator_profiles' },
    { table: 'subreddit_profiles' },
    { table: 'source_phone_links' },
    { table: 'ingest_runs', columns: ['tier', 'discovery_strategy', 'rejected_reason'] },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('ingest:auto', missing));
    process.exit(0);
  }
  const llm = getLlm();

  const http = makePoliteHttp({ db });
  const creators = await loadCreatorProfiles(db);
  const subs = await loadSubredditProfiles(db);

  // Load phone aliases once — the orchestrator caches internally for the run.
  const aliasLoader = makeDbAliasLoader(db);
  const aliases = await aliasLoader();

  const adapters = [
    new GsmArenaAdapter({
      http,
      getPhoneRawJson: async (phone) => {
        const rows = await db
          .select({ specJson: phones.specJson })
          .from(phones)
          .where(eq(phones.id, phone.id))
          .limit(1);
        const raw = rows[0]?.specJson as { gsmarenaUrl?: string } | null | undefined;
        return raw ?? null;
      },
    }),
    new YouTubeChannelAdapter({
      http,
      creators,
      aliases,
    }),
    new ArticleAdapter(),
    new RedditAdapter({ subredditProfiles: subs }),
  ];

  const orchestrator = new IngestOrchestrator({
    db,
    llm,
    adapters,
    aliasLoader: async () => aliases,
    phoneLookup: makeDbPhoneLookup(db),
  });

  const tiers: IngestTier[] | undefined = args.tier === 'all' ? undefined : [args.tier];

  const picked = await pickPhones(db, {
    tiers,
    limit: args.limit,
    shard: args.shard,
    totalShards: args.totalShards,
  });

  if (picked.length === 0) {
    console.log('[ingest:auto] no phones due this run');
    process.exit(0);
  }

  console.log(
    `[ingest:auto] picked ${picked.length} phones (tier=${args.tier}, shard=${args.shard}/${args.totalShards})`,
  );

  let successes = 0;
  let failures = 0;
  for (const phone of picked) {
    try {
      const summary = await orchestrator.ingestPhone(
        {
          id: phone.id,
          slug: phone.slug,
          brand: phone.brand,
          model: phone.model,
          launchDate: phone.launchDate,
        },
        {
          discover: { limit: args.perPhoneLimit },
          dryRun: args.dryRun,
          tier: phone.tier,
          discoveryStrategy: 'tiered',
        },
      );
      console.log(
        `  ${phone.slug} (${phone.tier})  sources=${summary.totals.sourcesWritten} ` +
          `chunks=${summary.totals.chunksWritten} errors=${summary.totals.errors}`,
      );
      if (!args.dryRun) {
        await markIngested(db, { phoneId: phone.id, tier: phone.tier });

        // Nudge scorecard schedule — re-score 24h after fresh ingestion
        // Only bring forward, never push back a sooner deadline.
        if (summary.totals.chunksWritten > 0) {
          const nudgeTarget = new Date(Date.now() + 24 * 60 * 60 * 1000);
          await db
            .update(phones)
            .set({
              nextScorecardAt: nudgeTarget,
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(phones.id, phone.id),
                or(isNull(phones.nextScorecardAt), gt(phones.nextScorecardAt, nudgeTarget)),
              ),
            );
        }
      }
      successes += 1;
    } catch (err) {
      failures += 1;
      logger.error(
        { phone: phone.slug, err: err instanceof Error ? err.message : String(err) },
        'phone ingest failed',
      );
    }
  }

  console.log(
    `[ingest:auto] done successes=${successes} failures=${failures} total=${picked.length}`,
  );
  process.exit(failures > 0 && successes === 0 ? 1 : 0);
}

main().catch((err) => {
  logger.error({ err: summarizeErrorChainForLogs(err) }, 'ingest:auto crashed');
  console.error('[ingest:auto] FAILED');
  console.error(summarizeErrorChainForLogs(err));
  process.exit(1);
});

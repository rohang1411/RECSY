#!/usr/bin/env tsx
/**
 * Automated catalog refresh entrypoint.
 *
 * Current implementation slice:
 *   - no LLM calls;
 *   - discovers recent phones from Wikidata;
 *   - globally upserts staged catalog candidates and snapshots;
 *   - does NOT auto-promote into `phones` yet because Wikidata does not
 *     provide enough structured specs to satisfy `PhoneSpecSchema`.
 *
 * Usage:
 *   pnpm catalog:refresh --source wikidata --since-years 2 --limit 150
 *   pnpm catalog:refresh --source wikidata --since-years 2 --dry-run
 */
import { and, eq, sql } from 'drizzle-orm';

import {
  buildCanonicalKey,
  compareCatalogPriorityThenNewest,
  discoverRecentWikidataPhones,
  hashJson,
  stableCandidateKey,
} from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import {
  catalogCandidates,
  catalogRuns,
  catalogSnapshots,
  catalogSourceProfiles,
} from '../src/services/db/schema';

interface CliArgs {
  readonly source: 'wikidata';
  readonly limit: number;
  readonly sinceYears: number;
  readonly dryRun: boolean;
  readonly maxRequests: number;
  readonly maxNew: number;
  readonly maxLlmCalls: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: {
    source: 'wikidata';
    limit: number;
    sinceYears: number;
    dryRun: boolean;
    maxRequests: number;
    maxNew: number;
    maxLlmCalls: number;
  } = {
    source: 'wikidata',
    limit: 150,
    sinceYears: 2,
    dryRun: false,
    maxRequests: 200,
    maxNew: 20,
    maxLlmCalls: 0,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--source': {
        const source = argv[++i];
        if (source !== 'wikidata') exitWithUsage(`Unsupported --source: ${source}`);
        args.source = source;
        break;
      }
      case '--limit':
        args.limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--since-years':
        args.sinceYears = parsePositiveInt(argv[++i], '--since-years');
        break;
      case '--max-requests':
        args.maxRequests = parsePositiveInt(argv[++i], '--max-requests');
        break;
      case '--max-new':
        args.maxNew = parsePositiveInt(argv[++i], '--max-new');
        break;
      case '--max-llm-calls':
        args.maxLlmCalls = parseNonNegativeInt(argv[++i], '--max-llm-calls');
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${flag}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.maxLlmCalls > 0) {
    console.warn(
      '[catalog:refresh] --max-llm-calls ignored in current implementation; this path makes 0 LLM calls.',
    );
  }

  const since = new Date();
  since.setUTCFullYear(since.getUTCFullYear() - args.sinceYears);

  if (args.dryRun) {
    const candidates = await discoverRecentWikidataPhones({
      since,
      limit: discoveryFetchLimit(args.limit),
    });
    const sortedCandidates = sortWikidataCandidates(candidates).slice(0, args.limit);
    console.log(
      `[catalog:refresh] dry-run source=${args.source} discovered=${sortedCandidates.length} scanned=${candidates.length} promoted=0 llm_calls=0`,
    );
    for (const candidate of sortedCandidates.slice(0, 10)) {
      console.log(
        `  ${candidate.externalId} ${candidate.title} (${candidate.releaseDate ?? 'unknown date'})`,
      );
    }
    if (sortedCandidates.length > 10) {
      console.log(`  ... ${sortedCandidates.length - 10} more`);
    }
    return;
  }

  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'catalog_runs' },
    { table: 'catalog_source_profiles' },
    { table: 'catalog_snapshots' },
    { table: 'catalog_candidates' },
    { table: 'phones', columns: ['canonical_key', 'catalog_last_seen_at'] },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:refresh', missing));
    process.exit(0);
  }

  const startedAt = Date.now();
  const [run] = await db
    .insert(catalogRuns)
    .values({
      kind: 'manual',
      status: 'running',
      stage: 'discover',
      maxRequests: args.maxRequests,
      maxNewPromotions: args.maxNew,
      maxLlmCalls: 0,
      checkpointJson: { source: args.source, sinceYears: args.sinceYears, limit: args.limit },
    })
    .returning({ id: catalogRuns.id });
  if (!run) throw new Error('catalog run insert returned no row');

  try {
    const sourceProfile = await db
      .select({
        sourceKey: catalogSourceProfiles.sourceKey,
        enabled: catalogSourceProfiles.enabled,
      })
      .from(catalogSourceProfiles)
      .where(eq(catalogSourceProfiles.sourceKey, args.source))
      .limit(1);
    if (sourceProfile[0]?.enabled === false) {
      throw new Error(`catalog source disabled: ${args.source}`);
    }

    const candidates = await discoverRecentWikidataPhones({
      since,
      limit: discoveryFetchLimit(args.limit),
    });

    // Sort by shared policy: priority brands first, newest released phones next.
    const sortedCandidates = sortWikidataCandidates(candidates).slice(0, args.limit);

    let created = 0;
    let updated = 0;
    for (const candidate of sortedCandidates) {
      const stableKey = stableCandidateKey({
        sourceKey: candidate.sourceKey,
        externalId: candidate.externalId,
        sourceUrl: candidate.sourceUrl,
      });
      const contentHash = hashJson(candidate.raw);

      const [snapshot] = await db
        .insert(catalogSnapshots)
        .values({
          sourceKey: candidate.sourceKey,
          url: candidate.sourceUrl,
          canonicalUrl: candidate.sourceUrl,
          contentHash,
          headersJson: {},
          contentType: 'application/sparql-results+json',
          status: 'active',
        })
        .onConflictDoUpdate({
          target: [catalogSnapshots.sourceKey, catalogSnapshots.contentHash],
          set: {
            url: sql`excluded.url`,
            canonicalUrl: sql`excluded.canonical_url`,
            fetchedAt: sql`now()`,
            status: sql`excluded.status`,
          },
        })
        .returning({ id: catalogSnapshots.id });

      const prior = await db
        .select({ id: catalogCandidates.id })
        .from(catalogCandidates)
        .where(eq(catalogCandidates.stableKey, stableKey))
        .limit(1);
      if (prior.length === 0) created += 1;
      else updated += 1;

      const canonicalKey =
        candidate.brand && candidate.model
          ? buildCanonicalKey({
              brand: candidate.brand,
              model: candidate.model,
              launchDate: candidate.releaseDate,
            })
          : null;

      await db
        .insert(catalogCandidates)
        .values({
          firstRunId: run.id,
          lastRunId: run.id,
          stableKey,
          sourceKey: candidate.sourceKey,
          sourceType: candidate.sourceType,
          externalId: candidate.externalId,
          sourceUrl: candidate.sourceUrl,
          candidateTitle: candidate.title,
          rawCandidateJson: candidate.raw,
          normalizedIdentityJson: {
            brand: candidate.brand ?? null,
            model: candidate.model ?? candidate.title,
            launchDate: candidate.releaseDate ?? null,
            releaseDate: candidate.releaseDate ?? null,
            officialUrl: candidate.officialUrl ?? null,
            aliases: candidate.aliases,
          },
          claimsJson: {
            identity: candidate.raw,
            note: 'Wikidata discovery only; not enough structured specs for auto-promotion.',
          },
          canonicalKey,
          contentHash,
          lastSnapshotId: snapshot?.id ?? null,
          decision: 'pending_review',
          status: 'discovered',
          confidence: '0.70',
          issueCodes: ['spec_projection_missing'],
          lastDecisionAt: new Date(),
        })
        .onConflictDoUpdate({
          target: catalogCandidates.stableKey,
          set: {
            lastRunId: sql`excluded.last_run_id`,
            sourceUrl: sql`excluded.source_url`,
            candidateTitle: sql`excluded.candidate_title`,
            rawCandidateJson: sql`excluded.raw_candidate_json`,
            normalizedIdentityJson: sql`excluded.normalized_identity_json`,
            claimsJson: sql`excluded.claims_json`,
            canonicalKey: sql`excluded.canonical_key`,
            contentHash: sql`excluded.content_hash`,
            lastSnapshotId: sql`excluded.last_snapshot_id`,
            decision: sql`
              case
                when ${catalogCandidates.status} in ('quarantined', 'skipped', 'ready_to_promote', 'promoted', 'failed_transient')
                then ${catalogCandidates.decision}
                else excluded.decision
              end
            `,
            status: sql`
              case
                when ${catalogCandidates.status} in ('quarantined', 'skipped', 'ready_to_promote', 'promoted', 'failed_transient')
                then ${catalogCandidates.status}
                else excluded.status
              end
            `,
            confidence: sql`excluded.confidence`,
            issueCodes: sql`
              case
                when ${catalogCandidates.status} in ('quarantined', 'skipped', 'ready_to_promote', 'promoted', 'failed_transient')
                then ${catalogCandidates.issueCodes}
                else excluded.issue_codes
              end
            `,
            retryAfter: sql`
              case
                when ${catalogCandidates.status} in ('quarantined', 'skipped', 'ready_to_promote', 'promoted', 'failed_transient')
                then ${catalogCandidates.retryAfter}
                else null
              end
            `,
            seenCount: sql`${catalogCandidates.seenCount} + 1`,
            lastDecisionAt: sql`
              case
                when ${catalogCandidates.status} in ('quarantined', 'skipped', 'ready_to_promote', 'promoted', 'failed_transient')
                then ${catalogCandidates.lastDecisionAt}
                else now()
              end
            `,
            updatedAt: sql`now()`,
          },
        });
    }

    await db
      .update(catalogSourceProfiles)
      .set({ lastPolledAt: sql`now()`, lastSuccessfulAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(catalogSourceProfiles.sourceKey, args.source));

    await db
      .update(catalogRuns)
      .set({
        status: 'success',
        stage: 'done',
        createdCount: created,
        updatedCount: updated,
        skippedCount: 0,
        quarantinedCount: 0,
        requestCount: 1,
        llmCallCount: 0,
        finishedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(catalogRuns.id, run.id));

    console.log(
      `[catalog:refresh] done source=${args.source} discovered=${candidates.length} ` +
        `created=${created} updated=${updated} promoted=0 llm_calls=0`,
    );
    console.log(
      '[catalog:refresh] note: Wikidata candidates are staged as pending_review until a no-LLM spec source can satisfy PhoneSpecSchema.',
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(catalogRuns)
      .set({
        status: 'failed',
        error: message.slice(0, 2_000),
        errorCode: 'unknown',
        finishedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
      })
      .where(and(eq(catalogRuns.id, run.id), eq(catalogRuns.status, 'running')));
    throw err;
  }
}

function sortWikidataCandidates<
  T extends {
    brand?: string | null;
    model?: string | null;
    title: string;
    releaseDate?: string | null;
  },
>(candidates: readonly T[]): T[] {
  return [...candidates].sort((a, b) =>
    compareCatalogPriorityThenNewest(
      { brand: a.brand, model: a.model, title: a.title, releaseDate: a.releaseDate },
      { brand: b.brand, model: b.model, title: b.title, releaseDate: b.releaseDate },
    ),
  );
}

function discoveryFetchLimit(limit: number): number {
  return Math.max(limit, Math.min(limit * 4, 500));
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:refresh [options]',
      '',
      'Options:',
      '  --source wikidata       Discovery source (default: wikidata)',
      '  --since-years N         Discover candidates released in the last N years (default: 2)',
      '  --limit N               Max candidates to fetch from source (default: 150)',
      '  --max-requests N        Run request budget (default: 200)',
      '  --max-new N             Scheduled new promotion cap (default: 20; promotions not implemented yet)',
      '  --max-llm-calls N       Ignored for this no-LLM implementation (always 0)',
      '  --dry-run               Fetch and print candidates without writing to the database',
      '  --help                  Print this message',
    ].join('\n'),
  );
}

function exitWithUsage(message: string): never {
  console.error(`[catalog:refresh] ${message}\n`);
  printUsage();
  process.exit(2);
}

main().catch((err) => {
  console.error('[catalog:refresh] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

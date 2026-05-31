#!/usr/bin/env tsx
/**
 * Catalog refresh report.
 *
 * Purpose: print a compact operator digest for staged catalog candidates,
 * source health, and LLM usage. The current catalog refresh path makes zero
 * LLM calls; this report keeps that visible.
 *
 * Usage:
 *   pnpm catalog:report --days 30
 */
import { asc, desc, gte, sql } from 'drizzle-orm';

import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';

interface CliArgs {
  readonly days: number;
  readonly namesLimit: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let days = 30;
  let namesLimit = 5;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--days': {
        const parsed = Number(argv[++i]);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error('Invalid --days');
        }
        days = parsed;
        break;
      }
      case '--names-limit': {
        const parsed = Number(argv[++i]);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error('Invalid --names-limit');
        }
        namesLimit = parsed;
        break;
      }
      case '--help':
      case '-h':
        console.log('Usage: pnpm catalog:report --days 30 [--names-limit 5]');
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return { days, namesLimit };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'catalog_runs' },
    { table: 'catalog_candidates' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:report', missing));
    process.exit(0);
  }

  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const runs = await db
    .select({
      status: catalogRuns.status,
      n: sql<number>`count(*)::int`,
      requests: sql<number>`coalesce(sum(${catalogRuns.requestCount}), 0)::int`,
      llmCalls: sql<number>`coalesce(sum(${catalogRuns.llmCallCount}), 0)::int`,
    })
    .from(catalogRuns)
    .where(gte(catalogRuns.startedAt, since))
    .groupBy(catalogRuns.status)
    .orderBy(desc(sql<number>`count(*)`));

  const candidates = await db
    .select({
      status: catalogCandidates.status,
      decision: catalogCandidates.decision,
      n: sql<number>`count(*)::int`,
    })
    .from(catalogCandidates)
    .groupBy(catalogCandidates.status, catalogCandidates.decision)
    .orderBy(desc(sql<number>`count(*)`));

  const [signals] = await db
    .select({
      promotedLastWindow: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'promoted' and ${catalogCandidates.updatedAt} >= ${since})::int`,
      readyToPromote: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'ready_to_promote')::int`,
      needsEnrichment: sql<number>`count(*) filter (where 'needs_enrichment' = any(${catalogCandidates.issueCodes}))::int`,
      lowCompletenessPromoted: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'promoted' and 'low_completeness' = any(${catalogCandidates.issueCodes}))::int`,
      nonPhoneSkipped: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'skipped' and 'non_phone_device' = any(${catalogCandidates.issueCodes}))::int`,
      longTailPruned: sql<number>`count(*) filter (where ${catalogCandidates.status} = 'skipped' and 'long_tail_pruned' = any(${catalogCandidates.issueCodes}))::int`,
      unreleasedBlocked: sql<number>`count(*) filter (where 'unreleased_candidate' = any(${catalogCandidates.issueCodes}))::int`,
    })
    .from(catalogCandidates);

  const candidateDetails =
    args.namesLimit > 0
      ? await db
          .select({
            title: catalogCandidates.candidateTitle,
            status: catalogCandidates.status,
            decision: catalogCandidates.decision,
            issueCodes: catalogCandidates.issueCodes,
            retryAfter: catalogCandidates.retryAfter,
            updatedAt: catalogCandidates.updatedAt,
          })
          .from(catalogCandidates)
          .orderBy(
            asc(catalogCandidates.status),
            asc(catalogCandidates.decision),
            desc(catalogCandidates.updatedAt),
          )
      : [];
  const examplesByBucket = groupCandidateExamples(candidateDetails, args.namesLimit);

  console.log(`[catalog:report] last ${args.days} days`);
  console.log('\nruns');
  if (runs.length === 0) console.log('  (none)');
  for (const row of runs) {
    console.log(
      `  status=${row.status.padEnd(10)} runs=${row.n} requests=${row.requests} llm_calls=${row.llmCalls}`,
    );
  }

  console.log('\nsignals');
  if (signals) {
    console.log(
      `  promoted_last_${args.days}d=${signals.promotedLastWindow} ready_to_promote=${signals.readyToPromote} needs_enrichment=${signals.needsEnrichment} low_completeness_promoted=${signals.lowCompletenessPromoted}`,
    );
    console.log(
      `  skipped_non_phone=${signals.nonPhoneSkipped} long_tail_pruned=${signals.longTailPruned} unreleased_blocked=${signals.unreleasedBlocked}`,
    );
  }

  console.log('\ncandidates');
  if (candidates.length === 0) console.log('  (none)');
  for (const row of candidates) {
    const bucketKey = candidateBucketKey(row.status, row.decision);
    console.log(
      `  status=${row.status.padEnd(12)} decision=${(row.decision ?? 'null').padEnd(16)} n=${row.n}`,
    );
    const examples = examplesByBucket.get(bucketKey) ?? [];
    for (const example of examples) {
      const issues = example.issueCodes.length > 0 ? ` issues=${example.issueCodes.join(',')}` : '';
      const retry = example.retryAfter ? ` retry_after=${example.retryAfter.toISOString()}` : '';
      console.log(`    - ${example.title}${issues}${retry}`);
    }
    if (row.n > examples.length && args.namesLimit > 0) {
      console.log(`    ... ${row.n - examples.length} more`);
    }
  }
}

interface CandidateDetail {
  readonly title: string;
  readonly status: string;
  readonly decision: string | null;
  readonly issueCodes: readonly string[];
  readonly retryAfter: Date | null;
}

function groupCandidateExamples(
  rows: readonly CandidateDetail[],
  namesLimit: number,
): Map<string, CandidateDetail[]> {
  const buckets = new Map<string, CandidateDetail[]>();
  for (const row of rows) {
    const key = candidateBucketKey(row.status, row.decision);
    const bucket = buckets.get(key) ?? [];
    if (bucket.length >= namesLimit) continue;
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return buckets;
}

function candidateBucketKey(status: string, decision: string | null): string {
  return `${status}\u0000${decision ?? 'null'}`;
}

main().catch((err) => {
  console.error('[catalog:report] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

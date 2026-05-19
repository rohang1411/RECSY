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
import { desc, gte, sql } from 'drizzle-orm';

import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';

interface CliArgs {
  readonly days: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let days = 30;
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
      case '--help':
      case '-h':
        console.log('Usage: pnpm catalog:report --days 30');
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return { days };
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

  console.log(`[catalog:report] last ${args.days} days`);
  console.log('\nruns');
  if (runs.length === 0) console.log('  (none)');
  for (const row of runs) {
    console.log(
      `  status=${row.status.padEnd(10)} runs=${row.n} requests=${row.requests} llm_calls=${row.llmCalls}`,
    );
  }

  console.log('\ncandidates');
  if (candidates.length === 0) console.log('  (none)');
  for (const row of candidates) {
    console.log(
      `  status=${row.status.padEnd(12)} decision=${(row.decision ?? 'null').padEnd(16)} n=${row.n}`,
    );
  }
}

main().catch((err) => {
  console.error('[catalog:report] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

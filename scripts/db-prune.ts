#!/usr/bin/env tsx
/**
 * Database Retention Pruning Script
 *
 * Implements bounded, idempotent retention pruning across disposable telemetry,
 * expired LLM cache, completed queue logs, and expired rate limits.
 *
 * Usage:
 *   pnpm db:prune [--dry-run] [--batch-size=500]
 */
import { parseArgs } from 'node:util';
import { getPostgres } from '../src/services/db/client';

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'dry-run': { type: 'boolean', default: false },
      'batch-size': { type: 'string', default: '500' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (args.help) {
    console.log(`
Usage: pnpm db:prune [options]

Options:
  --dry-run          Count eligible records without deleting
  --batch-size N     Max rows to delete per table in one pass (default: 500)
  --help             Show help
`);
    process.exit(0);
  }

  const dryRun = Boolean(args['dry-run']);
  const batchSize = Math.max(10, parseInt(args['batch-size'] ?? '500', 10));

  console.log(`[db:prune] Starting retention pruning (dryRun=${dryRun}, batchSize=${batchSize})`);
  const sql = getPostgres();

  const results: Record<string, number> = {};

  // 1. LLM cache older than 30 days
  const [llmCacheCount] = await sql`
    SELECT count(*)::int as n FROM llm_cache WHERE created_at < now() - interval '30 days'
  `;
  results.expiredLlmCache = Number(llmCacheCount?.n ?? 0);
  if (!dryRun && results.expiredLlmCache > 0) {
    await sql`
      DELETE FROM llm_cache
      WHERE id IN (
        SELECT id FROM llm_cache
        WHERE created_at < now() - interval '30 days'
        LIMIT ${batchSize}
      )
    `;
  }

  // 2. Rate limits older than 24 hours
  const [rateLimitsCount] = await sql`
    SELECT count(*)::int as n FROM rate_limits WHERE window_start < now() - interval '24 hours'
  `;
  results.expiredRateLimits = Number(rateLimitsCount?.n ?? 0);
  if (!dryRun && results.expiredRateLimits > 0) {
    await sql`
      DELETE FROM rate_limits
      WHERE id IN (
        SELECT id FROM rate_limits
        WHERE window_start < now() - interval '24 hours'
        LIMIT ${batchSize}
      )
    `;
  }

  // 3. Completed crawl queue older than 7 days
  const [crawlQueueCount] = await sql`
    SELECT count(*)::int as n FROM crawl_queue
    WHERE status = 'completed' AND scheduled_for < now() - interval '7 days'
  `;
  results.completedCrawlQueue = Number(crawlQueueCount?.n ?? 0);
  if (!dryRun && results.completedCrawlQueue > 0) {
    await sql`
      DELETE FROM crawl_queue
      WHERE id IN (
        SELECT id FROM crawl_queue
        WHERE status = 'completed' AND scheduled_for < now() - interval '7 days'
        LIMIT ${batchSize}
      )
    `;
  }

  // 4. Successful / skipped scorecard runs older than 30 days
  const [scorecardSuccessCount] = await sql`
    SELECT count(*)::int as n FROM scorecard_runs
    WHERE status IN ('success', 'skipped') AND started_at < now() - interval '30 days'
  `;
  results.oldScorecardRuns = Number(scorecardSuccessCount?.n ?? 0);
  if (!dryRun && results.oldScorecardRuns > 0) {
    await sql`
      DELETE FROM scorecard_runs
      WHERE id IN (
        SELECT id FROM scorecard_runs
        WHERE status IN ('success', 'skipped') AND started_at < now() - interval '30 days'
        LIMIT ${batchSize}
      )
    `;
  }

  // 5. Failed scorecard runs older than 90 days
  const [scorecardFailedCount] = await sql`
    SELECT count(*)::int as n FROM scorecard_runs
    WHERE status = 'failed' AND started_at < now() - interval '90 days'
  `;
  results.failedScorecardRunsOlderThan90d = Number(scorecardFailedCount?.n ?? 0);
  if (!dryRun && results.failedScorecardRunsOlderThan90d > 0) {
    await sql`
      DELETE FROM scorecard_runs
      WHERE id IN (
        SELECT id FROM scorecard_runs
        WHERE status = 'failed' AND started_at < now() - interval '90 days'
        LIMIT ${batchSize}
      )
    `;
  }

  // 6. Ingestion runs: completed older than 30 days, failed older than 90 days
  const [ingestOldCount] = await sql`
    SELECT count(*)::int as n FROM ingest_runs
    WHERE (status = 'completed' AND started_at < now() - interval '30 days')
       OR (status = 'failed' AND started_at < now() - interval '90 days')
  `;
  results.oldIngestRuns = Number(ingestOldCount?.n ?? 0);
  if (!dryRun && results.oldIngestRuns > 0) {
    await sql`
      DELETE FROM ingest_runs
      WHERE id IN (
        SELECT id FROM ingest_runs
        WHERE (status = 'completed' AND started_at < now() - interval '30 days')
           OR (status = 'failed' AND started_at < now() - interval '90 days')
        LIMIT ${batchSize}
      )
    `;
  }

  // 7. Inactive anonymous recommendation sessions older than 90 days
  const [sessionsOldCount] = await sql`
    SELECT count(*)::int as n FROM recommendation_sessions
    WHERE created_at < now() - interval '90 days'
  `;
  results.inactiveRecommendationSessions = Number(sessionsOldCount?.n ?? 0);
  if (!dryRun && results.inactiveRecommendationSessions > 0) {
    await sql`
      DELETE FROM recommendation_sessions
      WHERE id IN (
        SELECT id FROM recommendation_sessions
        WHERE created_at < now() - interval '90 days'
        LIMIT ${batchSize}
      )
    `;
  }

  console.log('[db:prune] Summary of candidates:');
  for (const [category, count] of Object.entries(results)) {
    console.log(`  - ${category}: ${count} rows`);
  }

  if (dryRun) {
    console.log('[db:prune] Dry run complete. No rows were deleted.');
  } else {
    console.log('[db:prune] Pruning pass complete.');
  }
}

main().catch((err) => {
  console.error('[db:prune] Failed:', err);
  process.exit(1);
});

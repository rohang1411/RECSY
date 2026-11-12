#!/usr/bin/env tsx
/**
 * Database Retention Pruning Script
 *
 * Implements bounded, idempotent retention pruning across disposable telemetry,
 * expired LLM cache, completed queue logs, and expired rate limits.
 *
 * Normative reference: Plan 27 WP-01 Hotfixes (Step 7: Inactive anonymous recommendation sessions).
 *
 * Usage:
 *   pnpm db:prune [--dry-run] [--batch-size=500]
 */
import { parseArgs } from 'node:util';
import type postgres from 'postgres';
import { getPostgres } from '../src/services/db/client';

export interface PruneOptions {
  readonly dryRun?: boolean;
  readonly batchSize?: number;
}

export interface PruneResults {
  expiredLlmCache: number;
  expiredRateLimits: number;
  completedCrawlQueue: number;
  oldScorecardRuns: number;
  failedScorecardRunsOlderThan90d: number;
  oldIngestRuns: number;
  deletedRecommendationSessions: number;
  inactiveGuestSessions: number;
  orphanedRecommendationClients: number;
  inactiveRecommendationSessions: number;
}

export async function pruneRetention(
  sql: ReturnType<typeof getPostgres>,
  options: PruneOptions = {},
): Promise<PruneResults> {
  const dryRun = Boolean(options.dryRun);
  const batchSize = Math.max(10, options.batchSize ?? 500);

  const results: PruneResults = {
    expiredLlmCache: 0,
    expiredRateLimits: 0,
    completedCrawlQueue: 0,
    oldScorecardRuns: 0,
    failedScorecardRunsOlderThan90d: 0,
    oldIngestRuns: 0,
    deletedRecommendationSessions: 0,
    inactiveGuestSessions: 0,
    orphanedRecommendationClients: 0,
    inactiveRecommendationSessions: 0,
  };

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

  // 7. Soft-deleted recommendation sessions older than 30 days (Plan 27 D27-2)
  const [deletedSessionsCount] = await sql`
    SELECT count(*)::int as n
    FROM recommendation_sessions
    WHERE status = 'deleted'
      AND deleted_at < now() - interval '30 days'
  `;
  results.deletedRecommendationSessions = Number(deletedSessionsCount?.n ?? 0);

  if (!dryRun && results.deletedRecommendationSessions > 0) {
    let totalPruned = 0;
    while (true) {
      const deletedBatch = await sql<{ id: string }[]>`
        DELETE FROM recommendation_sessions
        WHERE id IN (
          SELECT id
          FROM recommendation_sessions
          WHERE status = 'deleted'
            AND deleted_at < now() - interval '30 days'
          LIMIT ${batchSize}
        )
        RETURNING id
      `;
      totalPruned += deletedBatch.length;
      if (deletedBatch.length < batchSize) {
        break;
      }
    }
    results.deletedRecommendationSessions = totalPruned;
  }

  // 8. Inactive anonymous guest sessions older than 30 days (Plan 27 D27-3)
  // Signed-in users' sessions are NEVER pruned (s.user_id must be NULL and c.user_id must be NULL).
  const [guestSessionsCount] = await sql`
    SELECT count(*)::int as n
    FROM recommendation_sessions s
    LEFT JOIN recommendation_clients c ON s.client_id = c.id
    WHERE s.user_id IS NULL
      AND (c.user_id IS NULL OR s.client_id IS NULL)
      AND COALESCE(s.last_turn_at, s.updated_at, s.created_at) < now() - interval '30 days'
  `;
  results.inactiveGuestSessions = Number(guestSessionsCount?.n ?? 0);
  results.inactiveRecommendationSessions = results.inactiveGuestSessions;

  if (!dryRun && results.inactiveGuestSessions > 0) {
    let totalPruned = 0;
    while (true) {
      const deletedBatch = await sql<{ id: string }[]>`
        DELETE FROM recommendation_sessions
        WHERE id IN (
          SELECT s.id
          FROM recommendation_sessions s
          LEFT JOIN recommendation_clients c ON s.client_id = c.id
          WHERE s.user_id IS NULL
            AND (c.user_id IS NULL OR s.client_id IS NULL)
            AND COALESCE(s.last_turn_at, s.updated_at, s.created_at) < now() - interval '30 days'
          LIMIT ${batchSize}
        )
        RETURNING id
      `;
      totalPruned += deletedBatch.length;
      if (deletedBatch.length < batchSize) {
        break;
      }
    }
    results.inactiveGuestSessions = totalPruned;
    results.inactiveRecommendationSessions = totalPruned;
  }

  // 9. Orphaned recommendation clients with no associated sessions (Plan 27 WP-11)
  const [orphanedClientsCount] = await sql`
    SELECT count(*)::int as n
    FROM recommendation_clients c
    WHERE NOT EXISTS (
      SELECT 1 FROM recommendation_sessions s WHERE s.client_id = c.id
    )
  `;
  results.orphanedRecommendationClients = Number(orphanedClientsCount?.n ?? 0);

  if (!dryRun && results.orphanedRecommendationClients > 0) {
    let totalPruned = 0;
    while (true) {
      const deletedBatch = await sql<{ id: string }[]>`
        DELETE FROM recommendation_clients
        WHERE id IN (
          SELECT c.id
          FROM recommendation_clients c
          WHERE NOT EXISTS (
            SELECT 1 FROM recommendation_sessions s WHERE s.client_id = c.id
          )
          LIMIT ${batchSize}
        )
        RETURNING id
      `;
      totalPruned += deletedBatch.length;
      if (deletedBatch.length < batchSize) {
        break;
      }
    }
    results.orphanedRecommendationClients = totalPruned;
  }

  return results;
}

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

  const results = await pruneRetention(sql, { dryRun, batchSize });

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

if (process.argv[1]?.endsWith('db-prune.ts')) {
  main().catch((err) => {
    console.error('[db:prune] Failed:', err);
    process.exit(1);
  });
}

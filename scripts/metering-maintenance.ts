#!/usr/bin/env tsx
/**
 * Metering Maintenance Script.
 * Normative reference: Section 6.6, 7.4 of plan 25.
 *
 * Runs scheduled pruning and cleanup:
 *   1. Sweeps up to 500 expired reserved query leases and restores quota.
 *   2. Prunes daily usage counters older than 14 days.
 *   3. Prunes settled expired/no_charge leases older than 30 days.
 *   4. Prunes stale rate limit buckets older than 1 day.
 *
 * Usage:
 *   pnpm metering:maintain
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../src/env';
import { createPostgresClient } from '../src/services/db/connection';
import { logger } from '../src/services/logger';

const log = logger.child({ script: 'metering-maintenance' });

async function runMaintenance(): Promise<void> {
  const client = createPostgresClient(env.DATABASE_URL);
  const db = drizzle(client);

  try {
    log.info('starting metering maintenance cycle');

    // 1. Sweep expired leases (batch size: 500)
    const sweepRes = await db.execute<{ recsy_sweep_expired_leases: number }>(sql`
      SELECT recsy_sweep_expired_leases(500);
    `);
    const sweptCount = sweepRes[0]?.recsy_sweep_expired_leases ?? 0;
    log.info({ sweptCount }, 'swept expired leases');

    // 2. Prune usage counters older than 14 days
    const counterPruneRes = await db.execute(sql`
      DELETE FROM usage_counters
       WHERE usage_date < (now() AT TIME ZONE 'UTC')::date - interval '14 days';
    `);
    log.info({ pruned: counterPruneRes }, 'pruned usage_counters older than 14 days');

    // 3. Prune old non-billable leases older than 30 days
    const leasePruneRes = await db.execute(sql`
      DELETE FROM query_leases
       WHERE status IN ('expired', 'no_charge')
         AND reserved_at < now() - interval '30 days';
    `);
    log.info({ pruned: leasePruneRes }, 'pruned old expired/no_charge leases older than 30 days');

    // 4. Prune stale rate limits older than 1 day
    const rateLimitPruneRes = await db.execute(sql`
      DELETE FROM rate_limits
       WHERE window_start < now() - interval '1 day';
    `);
    log.info({ pruned: rateLimitPruneRes }, 'pruned rate limits older than 1 day');

    log.info('metering maintenance completed successfully');
  } catch (err) {
    log.error({ err }, 'metering maintenance failed');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

void runMaintenance();

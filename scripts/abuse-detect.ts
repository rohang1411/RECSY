#!/usr/bin/env tsx
/**
 * Automated Abuse Detection Job (Section 8.7 / WP-07).
 * Scans for device account farming and suspicious lease refund rates.
 * Automatically inserts expiring 24-hour abuse_blocks for operator review.
 *
 * Usage:
 *   pnpm tsx scripts/abuse-detect.ts [--dry-run]
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../src/env';
import { createPostgresClient } from '../src/services/db/connection';
import { logger } from '../src/services/logger';

const log = logger.child({ script: 'abuse-detect' });

async function runAbuseDetection(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  const client = createPostgresClient(env.DATABASE_URL);
  const db = drizzle(client);

  try {
    log.info({ isDryRun }, 'starting abuse detection sweep');

    // 1. Scan for devices associated with more than DEVICE_ACCOUNT_CAP distinct users in 24 hours
    const deviceFarmingRows = await db.execute<{ device_id: string; user_count: number }>(sql`
      SELECT device_id, count(DISTINCT user_id)::int AS user_count
        FROM query_leases
       WHERE user_id IS NOT NULL
         AND reserved_at > now() - interval '24 hours'
       GROUP BY device_id
      HAVING count(DISTINCT user_id) > ${env.DEVICE_ACCOUNT_CAP};
    `);

    log.info({ flaggedDevices: deviceFarmingRows.length }, 'scanned for device account farming');

    for (const row of deviceFarmingRows) {
      if (isDryRun) {
        log.info(
          { deviceId: row.device_id, userCount: row.user_count },
          '[DRY-RUN] would block device for account farming',
        );
      } else {
        await db.execute(sql`
          INSERT INTO abuse_blocks (kind, value, reason, created_by, expires_at)
          VALUES (
            'device',
            ${row.device_id},
            ${`Exceeded device account cap (${row.user_count} accounts in 24h)`},
            'abuse-detect-cron',
            now() + interval '24 hours'
          )
          ON CONFLICT (kind, value) DO UPDATE SET
            expires_at = now() + interval '24 hours',
            reason = EXCLUDED.reason;
        `);
        log.warn(
          { deviceId: row.device_id, userCount: row.user_count },
          'inserted expiring abuse block for device',
        );
      }
    }

    // 2. Scan for subjects with excessive refund/failure rates (>= 10 queries, >= 80% refunded)
    const refundAbuseRows = await db.execute<{
      subject_id: string;
      is_user: boolean;
      total_leases: number;
      refunded_leases: number;
    }>(sql`
      SELECT
        COALESCE(user_id::text, device_id) AS subject_id,
        (user_id IS NOT NULL) AS is_user,
        count(*)::int AS total_leases,
        count(*) FILTER (WHERE status = 'refunded')::int AS refunded_leases
        FROM query_leases
       WHERE reserved_at > now() - interval '24 hours'
       GROUP BY COALESCE(user_id::text, device_id), (user_id IS NOT NULL)
      HAVING count(*) >= 10
         AND (count(*) FILTER (WHERE status = 'refunded')::float / count(*)) >= 0.8;
    `);

    log.info({ flaggedSubjects: refundAbuseRows.length }, 'scanned for refund exploitation');

    for (const row of refundAbuseRows) {
      const kind = row.is_user ? 'user' : 'device';
      if (isDryRun) {
        log.info(
          {
            kind,
            subjectId: row.subject_id,
            refunded: row.refunded_leases,
            total: row.total_leases,
          },
          '[DRY-RUN] would block subject for excessive refunds',
        );
      } else {
        await db.execute(sql`
          INSERT INTO abuse_blocks (kind, value, reason, created_by, expires_at)
          VALUES (
            ${kind},
            ${row.subject_id},
            ${`Excessive refund rate: ${row.refunded_leases}/${row.total_leases} refunded in 24h`},
            'abuse-detect-cron',
            now() + interval '24 hours'
          )
          ON CONFLICT (kind, value) DO UPDATE SET
            expires_at = now() + interval '24 hours',
            reason = EXCLUDED.reason;
        `);
        log.warn(
          { kind, subjectId: row.subject_id },
          'inserted expiring abuse block for high refund ratio',
        );
      }
    }

    log.info('abuse detection sweep completed successfully');
  } catch (err) {
    log.error({ err }, 'abuse detection job failed');
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  void runAbuseDetection();
}

export { runAbuseDetection };

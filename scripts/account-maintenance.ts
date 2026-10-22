/**
 * Account maintenance and deferred deletion sweeper.
 * Normative reference: Plan 25 Section 10.5, WP-11.
 *
 * Runs on a schedule to execute account deletions that have passed their 30-day cooling period.
 * Usage: pnpm tsx scripts/account-maintenance.ts [--dry-run]
 */
import { sql } from 'drizzle-orm';
import { getDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { executeDeletion } from '@/services/account/deletion';

const log = logger.child({ component: 'account-maintenance' });

type PendingDeletionRow = Record<string, unknown> & {
  id: string;
  user_id: string;
  execute_after: Date | string;
};

export async function runAccountMaintenance(options?: {
  dryRun?: boolean;
}): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const dryRun = options?.dryRun ?? false;

  log.info({ dryRun }, 'starting account maintenance sweep');

  const dueRequests = await db.execute<PendingDeletionRow>(sql`
    SELECT id, user_id, execute_after
      FROM account_requests
     WHERE kind = 'delete'
       AND status = 'pending'
       AND execute_after <= now()
     LIMIT 50;
  `);

  log.info({ count: dueRequests.length }, 'found due deletion requests');

  let processed = 0;
  let failed = 0;

  for (const req of dueRequests) {
    const userId = req.user_id;

    if (dryRun) {
      log.info({ userId, requestId: req.id }, '[DRY RUN] would execute deletion');
      processed++;
      continue;
    }

    try {
      const result = await executeDeletion(db, userId);
      if (result.completed) {
        log.info({ userId, requestId: req.id }, 'successfully executed account deletion');
        processed++;
      } else {
        log.warn({ userId, requestId: req.id, reason: result.reason }, 'account deletion skipped');
        failed++;
      }
    } catch (err) {
      log.error({ err, userId, requestId: req.id }, 'failed to execute account deletion');
      failed++;
    }
  }

  log.info({ processed, failed }, 'completed account maintenance sweep');
  return { processed, failed };
}

if (process.env.NODE_ENV !== 'test' && require.main === module) {
  const isDryRun = process.argv.includes('--dry-run');
  runAccountMaintenance({ dryRun: isDryRun })
    .then((res) => {
      console.log(`Finished: ${res.processed} processed, ${res.failed} failed`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal error in account maintenance:', err);
      process.exit(1);
    });
}

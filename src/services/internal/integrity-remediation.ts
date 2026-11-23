/**
 * Command Center Autonomous Remediation Runbooks (Plan 32 WP-10).
 *
 * Implements deterministic maintenance runbooks for system integrity alerts:
 * 1. Prune zombie ingest runs exceeding timeout thresholds.
 * 2. Delete orphan chunks referencing deleted or non-existent phone rows.
 * 3. Inspect and flag catalog models with invalid/missing pricing.
 */
import type postgres from 'postgres';
import { getPostgres } from '@/services/db/client';
import { logger } from '@/services/logger';

export type RemediationAction =
  | 'prune_zombie_runs'
  | 'clean_orphan_chunks'
  | 'normalize_pricing'
  | 'all';

export interface RemediationResult {
  readonly success: boolean;
  readonly action: RemediationAction;
  readonly remediated: {
    readonly zombieRunsPruned: number;
    readonly orphanChunksDeleted: number;
    readonly invalidPricingIdentified: number;
  };
  readonly timestamp: string;
}

/**
 * Executes requested integrity remediation action against PostgreSQL database.
 */
export async function runIntegrityRemediation(
  action: RemediationAction,
  sql?: postgres.Sql,
): Promise<RemediationResult> {
  const db = sql ?? getPostgres();
  let zombieRunsPruned = 0;
  let orphanChunksDeleted = 0;
  let invalidPricingIdentified = 0;

  if (action === 'prune_zombie_runs' || action === 'all') {
    const res = await db`
      UPDATE ingest_runs
      SET status = 'failed', error = 'remediated_zombie_run_timeout'
      WHERE status::text IN ('started', 'running')
        AND started_at < NOW() - INTERVAL '2 hours'
      RETURNING id
    `;
    zombieRunsPruned = res.length;
    logger.info({ count: zombieRunsPruned }, 'integrity_remediation: pruned zombie ingest runs');
  }

  if (action === 'clean_orphan_chunks' || action === 'all') {
    const res = await db`
      DELETE FROM chunks
      WHERE phone_id NOT IN (SELECT id FROM phones)
      RETURNING id
    `;
    orphanChunksDeleted = res.length;
    logger.info({ count: orphanChunksDeleted }, 'integrity_remediation: deleted orphan chunks');
  }

  if (action === 'normalize_pricing' || action === 'all') {
    const res = await db`
      SELECT id, slug, model
      FROM phones
      WHERE status = 'active'
        AND (msrp_usd IS NULL OR msrp_usd::text ~ '^[0\.]+$' OR msrp_usd::text !~ '^[0-9]+(\.[0-9]{1,2})?$')
    `;
    invalidPricingIdentified = res.length;
    logger.info(
      { count: invalidPricingIdentified },
      'integrity_remediation: identified invalid pricing phones',
    );
  }

  return {
    success: true,
    action,
    remediated: {
      zombieRunsPruned,
      orphanChunksDeleted,
      invalidPricingIdentified,
    },
    timestamp: new Date().toISOString(),
  };
}

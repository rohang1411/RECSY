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

export interface RemediationOptions {
  readonly traceId?: string;
  readonly route?: string;
}

export interface RemediationResult {
  readonly success: boolean;
  readonly action: RemediationAction;
  readonly remediated: {
    readonly zombieRunsPruned: number;
    readonly orphanChunksDeleted: number;
    readonly invalidPricingIdentified: number;
    readonly invalidPricingPhones?: readonly {
      readonly id: string;
      readonly slug: string;
      readonly model: string;
    }[];
  };
  readonly timestamp: string;
}

/**
 * Executes requested integrity remediation action against PostgreSQL database.
 */
export async function runIntegrityRemediation(
  action: RemediationAction,
  sql?: postgres.Sql,
  options?: RemediationOptions,
): Promise<RemediationResult> {
  const db = sql ?? getPostgres();
  let zombieRunsPruned = 0;
  let orphanChunksDeleted = 0;
  let invalidPricingIdentified = 0;
  let invalidPricingPhones: { id: string; slug: string; model: string }[] | undefined;

  const safeTraceId = (options?.traceId ?? 'sys-remediation').replace(/[^a-zA-Z0-9_-]/g, '');
  const safeRoute = (options?.route ?? 'internal:integrity-remediation').replace(
    /[^a-zA-Z0-9_\- /:]/g,
    '',
  );
  const provenanceComment = db.unsafe
    ? db.unsafe(`/* traceId: ${safeTraceId}, route: ${safeRoute} */\n`)
    : '';

  if (action === 'prune_zombie_runs' || action === 'all') {
    const res = await db`
      ${provenanceComment}
      UPDATE ingest_runs
      SET status = 'failed',
          error = 'remediated_zombie_run_timeout',
          error_code = 'zombie_timeout',
          finished_at = NOW()
      WHERE status::text IN ('started', 'running')
        AND started_at < NOW() - INTERVAL '2 hours'
      RETURNING id
    `;
    zombieRunsPruned = res.length;
    logger.info({ count: zombieRunsPruned }, 'integrity_remediation: pruned zombie ingest runs');
  }

  if (action === 'clean_orphan_chunks' || action === 'all') {
    const res = await db`
      ${provenanceComment}
      DELETE FROM chunks
      WHERE NOT EXISTS (SELECT 1 FROM phones WHERE phones.id = chunks.phone_id)
      RETURNING id
    `;
    orphanChunksDeleted = res.length;
    logger.info({ count: orphanChunksDeleted }, 'integrity_remediation: deleted orphan chunks');
  }

  if (action === 'normalize_pricing' || action === 'all') {
    const res = await db<Array<{ id: string; slug: string; model: string }>>`
      ${provenanceComment}
      SELECT id, slug, model
      FROM phones
      WHERE status = 'active'
        AND (msrp_usd IS NULL OR msrp_usd::text ~ '^[0\.]+$' OR msrp_usd::text !~ '^[0-9]+(\.[0-9]{1,2})?$')
    `;
    invalidPricingIdentified = res.length;
    invalidPricingPhones = res.map((p) => ({
      id: String(p.id),
      slug: String(p.slug),
      model: String(p.model),
    }));
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
      invalidPricingPhones,
    },
    timestamp: new Date().toISOString(),
  };
}

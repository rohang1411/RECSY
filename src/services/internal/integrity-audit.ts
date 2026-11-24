/**
 * Command Center Automated System Integrity & Consistency Radar (Plan 31 WP-07).
 *
 * Single-pass PostgreSQL CTE audit scanning the catalog, corpuses, sources,
 * and background pipelines with minimal overhead (< 10ms execution).
 */

import fs from 'node:fs';
import path from 'node:path';
import type postgres from 'postgres';
import { getPostgres } from '@/services/db/client';
import { logger } from '@/services/logger';

export interface SystemIntegrityReport {
  readonly missingAspectsCount: number;
  readonly emptyCorpusesCount: number;
  readonly corruptedPricingCount: number;
  readonly orphanChunksCount: number;
  readonly malformedYtChannelsCount: number;
  readonly malformedYtSourcesCount: number;
  readonly zombieIngestRunsCount: number;
  readonly executionMs: number;
  readonly status: 'pass' | 'warn' | 'fail';
  readonly checkedAt: string;
  readonly codeHygieneStatus?: 'clean' | 'dead_code_detected' | 'unknown';
}

interface RawIntegrityRow {
  readonly missing_aspects_count: number;
  readonly empty_corpuses_count: number;
  readonly corrupted_pricing_count: number;
  readonly orphan_chunks_count: number;
  readonly malformed_yt_channels_count: number;
  readonly malformed_yt_sources_count: number;
  readonly zombie_ingest_runs_count: number;
}

export const FALLBACK_INTEGRITY_REPORT: SystemIntegrityReport = {
  missingAspectsCount: 0,
  emptyCorpusesCount: 0,
  corruptedPricingCount: 0,
  orphanChunksCount: 0,
  malformedYtChannelsCount: 0,
  malformedYtSourcesCount: 0,
  zombieIngestRunsCount: 0,
  executionMs: 0,
  status: 'fail',
  checkedAt: new Date().toISOString(),
};

/**
 * Runs the single-pass CTE consistency audit across active database tables.
 */
export async function runSystemIntegrityAudit(
  sql?: postgres.Sql,
  options?: { traceId?: string; route?: string },
): Promise<SystemIntegrityReport> {
  const t0 = performance.now();
  let dbSql: postgres.Sql | undefined = sql;
  if (!dbSql) {
    try {
      dbSql = getPostgres();
    } catch (err) {
      logger.error({ err }, 'failed to get database client for integrity audit');
      return {
        ...FALLBACK_INTEGRITY_REPORT,
        checkedAt: new Date().toISOString(),
        executionMs: Math.round((performance.now() - t0) * 10) / 10,
      };
    }
  }

  if (!dbSql) {
    logger.warn('no database client available for integrity audit');
    return {
      ...FALLBACK_INTEGRITY_REPORT,
      checkedAt: new Date().toISOString(),
      executionMs: Math.round((performance.now() - t0) * 10) / 10,
    };
  }

  try {
    const safeTraceId = (options?.traceId ?? 'sys-audit').replace(/[^a-zA-Z0-9_-]/g, '');
    const safeRoute = (options?.route ?? 'internal:integrity-audit').replace(
      /[^a-zA-Z0-9_\- /:]/g,
      '',
    );
    const provenanceComment = dbSql.unsafe
      ? dbSql.unsafe(`/* traceId: ${safeTraceId}, route: ${safeRoute} */\n`)
      : '';

    const rows = await dbSql<RawIntegrityRow[]>`
      ${provenanceComment}
      WITH
        missing_aspects AS (
          SELECT count(DISTINCT p.id)::int as count 
          FROM phones p
          LEFT JOIN aspects a ON p.id = a.phone_id
          WHERE p.status = 'active' AND a.id IS NULL
        ),
        empty_corpuses AS (
          SELECT count(DISTINCT p.id)::int as count 
          FROM phones p
          LEFT JOIN chunks c ON p.id = c.phone_id
          WHERE p.status = 'active' AND c.id IS NULL
        ),
        corrupted_pricing AS (
          SELECT count(*)::int as count 
          FROM phones p
          WHERE p.status = 'active' 
            AND (p.msrp_usd IS NULL OR p.msrp_usd::text ~ '^[0\.]+$' OR p.msrp_usd::text !~ '^[0-9]+(\.[0-9]{1,2})?$')
        ),
        orphan_chunks AS (
          SELECT count(*)::int as count 
          FROM chunks c
          LEFT JOIN phones p ON c.phone_id = p.id
          WHERE p.id IS NULL
        ),
        malformed_yt_channels AS (
          SELECT count(*)::int as count 
          FROM creator_profiles cp
          WHERE cp.platform = 'youtube' AND cp.external_id !~ '^UC[a-zA-Z0-9_-]{22}$'
        ),
        malformed_yt_sources AS (
          SELECT count(*)::int as count 
          FROM sources s
          WHERE s.type = 'youtube'
            AND (s.url IS NULL OR s.url !~ '(?:v=|\/embed\/|\/shorts\/|youtu\.be\/)([a-zA-Z0-9_-]{11})')
        ),
        zombie_ingest_runs AS (
          SELECT count(*)::int as count 
          FROM ingest_runs r
          WHERE r.status::text IN ('started', 'running') AND r.started_at < NOW() - INTERVAL '2 hours'
        )
      SELECT
        (SELECT count FROM missing_aspects) as missing_aspects_count,
        (SELECT count FROM empty_corpuses) as empty_corpuses_count,
        (SELECT count FROM corrupted_pricing) as corrupted_pricing_count,
        (SELECT count FROM orphan_chunks) as orphan_chunks_count,
        (SELECT count FROM malformed_yt_channels) as malformed_yt_channels_count,
        (SELECT count FROM malformed_yt_sources) as malformed_yt_sources_count,
        (SELECT count FROM zombie_ingest_runs) as zombie_ingest_runs_count;
    `;

    const r = rows[0];
    const executionMs = Math.round((performance.now() - t0) * 10) / 10;

    if (!r) {
      return {
        ...FALLBACK_INTEGRITY_REPORT,
        checkedAt: new Date().toISOString(),
        executionMs,
      };
    }

    const missingAspects = Number(r.missing_aspects_count) || 0;
    const emptyCorpuses = Number(r.empty_corpuses_count) || 0;
    const corruptedPricing = Number(r.corrupted_pricing_count) || 0;
    const orphanChunks = Number(r.orphan_chunks_count) || 0;
    const malformedYtChannels = Number(r.malformed_yt_channels_count) || 0;
    const malformedYtSources = Number(r.malformed_yt_sources_count) || 0;
    const zombieRuns = Number(r.zombie_ingest_runs_count) || 0;

    let status: 'pass' | 'warn' | 'fail' = 'pass';
    if (corruptedPricing > 0 || orphanChunks > 0 || malformedYtChannels > 0) {
      status = 'fail';
    } else if (
      missingAspects > 0 ||
      emptyCorpuses > 0 ||
      malformedYtSources > 0 ||
      zombieRuns > 0
    ) {
      status = 'warn';
    }

    let codeHygieneStatus: 'clean' | 'dead_code_detected' | 'unknown' = 'unknown';
    try {
      const hygienePath = path.join(
        process.cwd(),
        '.system',
        'diagnostics',
        'code_hygiene_status.json',
      );
      if (fs.existsSync(hygienePath)) {
        const raw = JSON.parse(fs.readFileSync(hygienePath, 'utf8'));
        codeHygieneStatus =
          raw.status === 'pass' && raw.checks?.evalRunners?.status === 'clean'
            ? 'clean'
            : 'dead_code_detected';
      }
    } catch {
      // Ignore filesystem read failure
    }

    return {
      missingAspectsCount: missingAspects,
      emptyCorpusesCount: emptyCorpuses,
      corruptedPricingCount: corruptedPricing,
      orphanChunksCount: orphanChunks,
      malformedYtChannelsCount: malformedYtChannels,
      malformedYtSourcesCount: malformedYtSources,
      zombieIngestRunsCount: zombieRuns,
      executionMs,
      status,
      checkedAt: new Date().toISOString(),
      codeHygieneStatus,
    };
  } catch (err) {
    logger.error({ err }, 'system integrity audit query failed');
    return {
      ...FALLBACK_INTEGRITY_REPORT,
      checkedAt: new Date().toISOString(),
      executionMs: Math.round((performance.now() - t0) * 10) / 10,
    };
  }
}

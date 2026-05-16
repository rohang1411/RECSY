/**
 * Scorecard Staleness Guard
 *
 * Computes chunk fingerprints to avoid wasting LLM calls on phones
 * whose active chunk corpus hasn't changed since the last complete scorecard run.
 */
import { sql } from 'drizzle-orm';
import { ASPECT_NAMES } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';

export async function computeChunkFingerprint(db: AppDb, phoneId: string): Promise<string> {
  const result = await db.execute<{ fingerprint: string }>(
    sql`SELECT md5(string_agg(c.id::text, ',' ORDER BY c.id)) AS fingerprint
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
        WHERE c.phone_id = ${phoneId}
          AND s.status = 'active'`,
  );

  return result[0]?.fingerprint || '';
}

/**
 * Returns the latest fingerprint only when every current scorecard aspect
 * succeeded for that same fingerprint and the current `aspects` row still
 * exists. A single successful aspect is not enough to skip the whole phone.
 */
export async function getLastScorecardFingerprint(
  db: AppDb,
  phoneId: string,
): Promise<string | null> {
  const result = await db.execute<{ chunk_fingerprint: string }>(
    sql`
      WITH latest_defs AS (
        SELECT DISTINCT ON (aspect) id, aspect
        FROM aspect_definitions
        ORDER BY aspect, version DESC
      )
      SELECT sr.chunk_fingerprint
      FROM scorecard_runs sr
      JOIN latest_defs ld ON ld.aspect = sr.aspect
      JOIN aspects a
        ON a.phone_id = sr.phone_id
       AND a.aspect_definition_id = ld.id
      WHERE sr.phone_id = ${phoneId}
        AND sr.status = 'success'
        AND sr.chunk_fingerprint IS NOT NULL
        AND sr.chunk_fingerprint <> ''
      GROUP BY sr.chunk_fingerprint
      HAVING count(DISTINCT sr.aspect) >= ${ASPECT_NAMES.length}
      ORDER BY max(sr.started_at) DESC
      LIMIT 1
    `,
  );

  return result[0]?.chunk_fingerprint ?? null;
}

export async function getCompletedAspectsForFingerprint(
  db: AppDb,
  phoneId: string,
  fingerprint: string,
): Promise<ReadonlySet<(typeof ASPECT_NAMES)[number]>> {
  if (fingerprint.length === 0) return new Set();

  const result = await db.execute<{ aspect: (typeof ASPECT_NAMES)[number] }>(
    sql`
      WITH latest_defs AS (
        SELECT DISTINCT ON (aspect) id, aspect
        FROM aspect_definitions
        ORDER BY aspect, version DESC
      )
      SELECT DISTINCT sr.aspect
      FROM scorecard_runs sr
      JOIN latest_defs ld ON ld.aspect = sr.aspect
      JOIN aspects a
        ON a.phone_id = sr.phone_id
       AND a.aspect_definition_id = ld.id
      WHERE sr.phone_id = ${phoneId}
        AND sr.status = 'success'
        AND sr.chunk_fingerprint = ${fingerprint}
    `,
  );

  return new Set(result.map((r) => r.aspect));
}

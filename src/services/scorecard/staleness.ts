/**
 * Scorecard Staleness Guard
 *
 * Computes chunk fingerprints to avoid wasting LLM calls on phones
 * whose chunk corpus hasn't changed since the last successful scorecard run.
 */
import { desc, eq, and, sql } from 'drizzle-orm';
import type { AppDb } from '@/services/db/client';
import { scorecardRuns } from '@/services/db/schema';

export async function computeChunkFingerprint(db: AppDb, phoneId: string): Promise<string> {
  const result = await db.execute<{ fingerprint: string }>(
    sql`SELECT md5(string_agg(id::text, ',' ORDER BY id)) AS fingerprint
        FROM chunks WHERE phone_id = ${phoneId}`,
  );

  return result[0]?.fingerprint || '';
}

export async function getLastScorecardFingerprint(
  db: AppDb,
  phoneId: string,
): Promise<string | null> {
  const [lastRun] = await db
    .select({ chunkFingerprint: scorecardRuns.chunkFingerprint })
    .from(scorecardRuns)
    .where(and(eq(scorecardRuns.phoneId, phoneId), eq(scorecardRuns.status, 'success')))
    .orderBy(desc(scorecardRuns.startedAt))
    .limit(1);

  return lastRun?.chunkFingerprint ?? null;
}

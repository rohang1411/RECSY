/**
 * Scorecard Scheduler
 *
 * Provides functions to pick phones due for scorecard generation and to mark
 * them as completed, updating their next scheduled run time.
 */
import { eq, isNull, sql } from 'drizzle-orm';
import { ASPECT_NAMES } from '@/lib/constants';
import { phones } from '@/services/db/schema';
import type { AppDb } from '@/services/db/client';
import { shardIndex } from '@/services/ingest/scheduler/pick-phones';

export interface PickScorecardPhonesOpts {
  limit?: number;
  onlyDue?: boolean;
  shard?: number;
  totalShards?: number;
  now?: Date;
}

export interface ScorecardPickedPhone {
  id: string;
  slug: string;
  brand: string;
  model: string;
  lastScorecardAt: Date | null;
  lastIngestAt: Date | null;
  activeChunkCount: number;
  currentAspectCount: number;
}

interface ScorecardCandidateRow {
  readonly [key: string]: unknown;
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly last_scorecard_at: Date | null;
  readonly last_ingest_at: Date | null;
  readonly active_chunk_count: number | string;
  readonly current_aspect_count: number | string;
}

export async function pickScorecardPhones(
  db: AppDb,
  opts: PickScorecardPhonesOpts = {},
): Promise<ScorecardPickedPhone[]> {
  const onlyDue = opts.onlyDue ?? true;
  const limit = opts.limit ?? 25;
  const now = opts.now ?? new Date();
  const totalShards = Math.max(1, opts.totalShards ?? 1);
  const shard = Math.max(0, Math.min(opts.shard ?? 0, totalShards - 1));

  const rows = await db.execute<ScorecardCandidateRow>(
    sql`
      WITH latest_defs AS (
        SELECT DISTINCT ON (aspect) id, aspect
        FROM aspect_definitions
        ORDER BY aspect, version DESC
      ),
      current_scores AS (
        SELECT a.phone_id, count(DISTINCT ld.aspect)::int AS current_aspect_count
        FROM aspects a
        JOIN latest_defs ld ON ld.id = a.aspect_definition_id
        GROUP BY a.phone_id
      ),
      active_chunks AS (
        SELECT c.phone_id, count(*)::int AS active_chunk_count
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
        WHERE s.status = 'active'
        GROUP BY c.phone_id
      )
      SELECT
        p.id,
        p.slug,
        p.brand,
        p.model,
        p.last_scorecard_at,
        p.last_ingest_at,
        coalesce(ac.active_chunk_count, 0)::int AS active_chunk_count,
        coalesce(cs.current_aspect_count, 0)::int AS current_aspect_count
      FROM phones p
      LEFT JOIN current_scores cs ON cs.phone_id = p.id
      LEFT JOIN active_chunks ac ON ac.phone_id = p.id
      WHERE p.status IN ('active', 'upcoming')
        AND coalesce(ac.active_chunk_count, 0) > 0
        AND (
          ${onlyDue} = false
          OR p.next_scorecard_at IS NULL
          OR p.next_scorecard_at <= ${now.toISOString()}::timestamptz
          OR coalesce(cs.current_aspect_count, 0) < ${ASPECT_NAMES.length}
        )
      ORDER BY
        (coalesce(cs.current_aspect_count, 0) < ${ASPECT_NAMES.length}) DESC,
        coalesce(p.last_scorecard_at, '1970-01-01'::timestamptz) ASC,
        coalesce(p.next_scorecard_at, '1970-01-01'::timestamptz) ASC
    `,
  );

  const filtered = rows.filter((r) => shardIndex(r.id, totalShards) === shard);

  return filtered.slice(0, limit).map((r) => ({
    id: r.id,
    slug: r.slug,
    brand: r.brand,
    model: r.model,
    lastScorecardAt: r.last_scorecard_at,
    lastIngestAt: r.last_ingest_at,
    activeChunkCount: Number(r.active_chunk_count),
    currentAspectCount: Number(r.current_aspect_count),
  }));
}

export async function markScorecardComplete(
  db: AppDb,
  input: { phoneId: string; at?: Date },
): Promise<void> {
  const at = input.at ?? new Date();

  // Read lastIngestAt to determine interval
  const [phone] = await db
    .select({ lastIngestAt: phones.lastIngestAt })
    .from(phones)
    .where(eq(phones.id, input.phoneId))
    .limit(1);

  if (!phone) return;

  const lastIngestMs = phone.lastIngestAt?.getTime() ?? 0;
  const ageDays = (at.getTime() - lastIngestMs) / (1000 * 60 * 60 * 24);

  // If ingested recently (within 7 days), re-score in 3 days.
  // Otherwise re-score in 7 days.
  const intervalDays = ageDays <= 7 ? 3 : 7;
  const next = new Date(at.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  await db
    .update(phones)
    .set({
      lastScorecardAt: at,
      nextScorecardAt: next,
      updatedAt: sql`now()`,
    })
    .where(eq(phones.id, input.phoneId));
}

export async function bootstrapNextScorecardAt(
  db: AppDb,
  opts: { now?: Date; random?: () => number } = {},
): Promise<{ updated: number }> {
  const now = opts.now ?? new Date();
  const rand = opts.random ?? Math.random;

  const rows = await db
    .select({ id: phones.id })
    .from(phones)
    .where(isNull(phones.nextScorecardAt));

  if (rows.length === 0) return { updated: 0 };

  let updated = 0;
  for (const r of rows) {
    const jitter = rand();
    // Default 3 days interval for bootstrap
    const next = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const intervalMs = next.getTime() - now.getTime();
    const nextJittered = new Date(next.getTime() - Math.floor(jitter * intervalMs));

    await db
      .update(phones)
      .set({ nextScorecardAt: nextJittered, updatedAt: sql`now()` })
      .where(eq(phones.id, r.id));
    updated += 1;
  }
  return { updated };
}

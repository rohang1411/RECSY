/**
 * Scheduler — bookkeeping helpers.
 *
 * After a phone has been ingested (or at least attempted), the scheduler
 * updates `phones.last_ingest_at` / `next_ingest_at` so it doesn't get
 * repolled before its tier-appropriate interval.
 *
 * We also expose a small helper to (re)compute `next_ingest_at` for every
 * phone that's missing one — used when bootstrapping after the migration.
 */
import { eq, isNull, sql } from 'drizzle-orm';

import { phones } from '@/services/db/schema';

import type { Db } from '../writer';
import { classifyTier, computeNextIngestAt, type IngestTier } from './tiers';

export interface MarkIngestedInput {
  readonly phoneId: string;
  readonly tier: IngestTier;
  readonly at?: Date;
}

export async function markIngested(db: Db, input: MarkIngestedInput): Promise<void> {
  const at = input.at ?? new Date();
  const next = computeNextIngestAt(input.tier, at);
  await db
    .update(phones)
    .set({ lastIngestAt: at, nextIngestAt: next, updatedAt: sql`now()` })
    .where(eq(phones.id, input.phoneId));
}

/**
 * Populate `next_ingest_at` for phones that don't have one yet (e.g. after
 * the migration ran). Uses the tier to pick an interval, offset from now by
 * a random fraction of it — so bootstrap doesn't schedule all phones at
 * the exact same instant.
 */
export async function bootstrapNextIngestAt(
  db: Db,
  opts: { now?: Date; random?: () => number } = {},
): Promise<{ updated: number }> {
  const now = opts.now ?? new Date();
  const rand = opts.random ?? Math.random;
  const rows = await db
    .select({ id: phones.id, launchDate: phones.launchDate })
    .from(phones)
    .where(isNull(phones.nextIngestAt));
  if (rows.length === 0) return { updated: 0 };

  let updated = 0;
  for (const r of rows) {
    const tier: IngestTier = classifyTier(r.launchDate ?? null);
    const jitter = rand();
    const next = computeNextIngestAt(tier, now);
    // Spread 0..100% of an interval backwards so roughly half the cohort
    // comes due immediately on the next cron. Keeps the curve smooth.
    const intervalMs = next.getTime() - now.getTime();
    const nextJittered = new Date(next.getTime() - Math.floor(jitter * intervalMs));
    await db
      .update(phones)
      .set({ nextIngestAt: nextJittered, updatedAt: sql`now()` })
      .where(eq(phones.id, r.id));
    updated += 1;
  }
  return { updated };
}

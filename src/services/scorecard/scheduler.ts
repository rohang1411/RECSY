/**
 * Scorecard Scheduler
 *
 * Provides functions to pick phones due for scorecard generation and to mark
 * them as completed, updating their next scheduled run time.
 */
import { and, asc, isNull, lte, or, sql, eq } from 'drizzle-orm';
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

  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      lastScorecardAt: phones.lastScorecardAt,
      lastIngestAt: phones.lastIngestAt,
    })
    .from(phones)
    .where(
      and(
        sql`${phones.status} in ('active', 'upcoming')`,
        onlyDue ? or(isNull(phones.nextScorecardAt), lte(phones.nextScorecardAt, now)) : sql`true`,
      ),
    )
    .orderBy(asc(sql`coalesce(${phones.lastScorecardAt}, '1970-01-01'::timestamptz)`));

  const filtered = rows.filter((r) => shardIndex(r.id, totalShards) === shard);

  return filtered.slice(0, limit);
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

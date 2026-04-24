/**
 * Scheduler — phone selection.
 *
 * Picks which phones should be ingested in the current run, honouring
 * freshness tiers (hot/warm/cold) and GitHub Actions matrix sharding.
 *
 * Selection rules:
 *   - A phone is "due" when `next_ingest_at <= now` (or null, treated as
 *     immediately due — freshly added phones auto-bootstrap).
 *   - We oversample `hot`, then `warm`, then `cold` to keep launch-window
 *     coverage dense without starving long-tail phones.
 *   - The `shard`/`totalShards` pair allows GH Actions to split work across
 *     parallel jobs deterministically (hash-mod on phone id).
 */
import { and, asc, isNull, lte, or, sql } from 'drizzle-orm';

import { phones } from '@/services/db/schema';

import type { Db } from '../writer';
import { classifyTier, type IngestTier } from './tiers';

export interface PickPhonesOptions {
  /** Which tiers to include. Default: all. */
  readonly tiers?: readonly IngestTier[];
  /** Only phones whose `next_ingest_at <= now` (or null). Default true. */
  readonly onlyDue?: boolean;
  /** Max phones to return. Default 50 per run. */
  readonly limit?: number;
  /** For sharding in GH Actions — 0-indexed. */
  readonly shard?: number;
  /** Total number of shards. 1 = no sharding. */
  readonly totalShards?: number;
  /** Override "now" for testing. */
  readonly now?: Date;
}

export interface PickedPhone {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly launchDate: string | null;
  readonly tier: IngestTier;
  readonly lastIngestAt: Date | null;
  readonly nextIngestAt: Date | null;
}

export async function pickPhones(db: Db, opts: PickPhonesOptions = {}): Promise<PickedPhone[]> {
  const onlyDue = opts.onlyDue ?? true;
  const limit = opts.limit ?? 50;
  const now = opts.now ?? new Date();
  const totalShards = Math.max(1, opts.totalShards ?? 1);
  const shard = Math.max(0, Math.min(opts.shard ?? 0, totalShards - 1));

  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      lastIngestAt: phones.lastIngestAt,
      nextIngestAt: phones.nextIngestAt,
      status: phones.status,
    })
    .from(phones)
    .where(
      and(
        // Active phones only — we still ingest `upcoming` to pre-warm launch-day.
        sql`${phones.status} in ('active', 'upcoming')`,
        onlyDue ? or(isNull(phones.nextIngestAt), lte(phones.nextIngestAt, now)) : sql`true`,
      ),
    )
    .orderBy(asc(sql`coalesce(${phones.nextIngestAt}, '1970-01-01'::timestamptz)`));

  const allowedTiers = new Set<IngestTier>(opts.tiers ?? ['hot', 'warm', 'cold']);

  const ranked = rows
    .map((r) => ({
      ...r,
      tier: classifyTier(r.launchDate ?? null),
    }))
    .filter((r) => allowedTiers.has(r.tier))
    .filter((r) => shardIndex(r.id, totalShards) === shard)
    // Prioritise hot, then warm, then cold within the due set.
    .sort((a, b) => tierOrder(a.tier) - tierOrder(b.tier));

  return ranked.slice(0, limit).map((r) => ({
    id: r.id,
    slug: r.slug,
    brand: r.brand,
    model: r.model,
    launchDate: r.launchDate ? r.launchDate.toISOString().slice(0, 10) : null,
    tier: r.tier,
    lastIngestAt: r.lastIngestAt,
    nextIngestAt: r.nextIngestAt,
  }));
}

/**
 * Deterministic shard index from a UUID/string id. Uses a small 32-bit FNV
 * hash so the same phone always goes to the same shard.
 */
export function shardIndex(id: string, totalShards: number): number {
  if (totalShards <= 1) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % totalShards;
}

function tierOrder(tier: IngestTier): number {
  if (tier === 'hot') return 0;
  if (tier === 'warm') return 1;
  return 2;
}

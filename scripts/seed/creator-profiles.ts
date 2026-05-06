/**
 * Seed `creator_profiles` — the YouTube channels whose uploads we actively
 * monitor. Channel IDs here are stable, public identifiers (the ones used by
 * https://www.youtube.com/feeds/videos.xml?channel_id=... for RSS polling).
 *
 * Expanding: add new rows to `CREATOR_SEEDS`; the seeder upserts on
 * (platform, external_id) so adding a row is always safe. If a known handle's
 * channel ID changes, the seeder disables stale active rows for that handle.
 *
 * Disabling a creator: set `status: 'disabled'` rather than deleting, so
 * older sources stay attributable.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { creatorProfiles } from '../../src/services/db/schema';

export interface CreatorSeed {
  platform: 'youtube' | 'reddit' | 'article';
  externalId: string;
  handle: string;
  trustWeight: string;
  notes?: string;
}

export const CREATOR_SEEDS: readonly CreatorSeed[] = [
  // The six YouTube channels called out in the implementation plan.
  // Trust weights intentionally differ — ranker should prefer specialist
  // long-form reviewers over news-style short-form.
  {
    platform: 'youtube',
    externalId: 'UCBJycsmduvYEL83R_U4JriQ',
    handle: 'MKBHD',
    trustWeight: '0.95',
    notes: 'Marques Brownlee — long-form flagship reviews; high reach, high signal.',
  },
  {
    platform: 'youtube',
    externalId: 'UCMiJRAwDNSNzuYeN2uWa0pA',
    handle: 'Mrwhosetheboss',
    trustWeight: '0.90',
    notes: 'Arun Maini — broad catalog coverage including budget and mid-range.',
  },
  {
    platform: 'youtube',
    externalId: 'UCzlXf-yUIaOpOjEjPrOO9TA',
    handle: 'TheTechChap',
    trustWeight: '0.85',
    notes: 'Tom Honeyands — practical, travel-photography focused reviews.',
  },
  {
    platform: 'youtube',
    externalId: 'UCIrrRLyFMVmmL9NDAU2obJA',
    handle: 'SuperSaf',
    trustWeight: '0.85',
    notes: 'Saf Malik — camera shootouts + long-term comparisons.',
  },
  {
    platform: 'youtube',
    externalId: 'UCaDBRJTQhIg_QhCkW7SxWGQ',
    handle: 'TheUnlockr',
    trustWeight: '0.80',
    notes: 'Jon Rettinger — launch-window reviews and network tests.',
  },
  {
    platform: 'youtube',
    externalId: 'UCSOpcUkE-is7u7c4AkLgqTw',
    handle: 'MrMobile',
    trustWeight: '0.85',
    notes: 'Michael Fisher — feature-film style reviews with real-world framing.',
  },
];

export async function seedCreatorProfiles(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<{ upserted: number; disabledStale: number }> {
  if (CREATOR_SEEDS.length === 0) return { upserted: 0, disabledStale: 0 };
  const rows = CREATOR_SEEDS.map((s) => ({
    platform: s.platform,
    externalId: s.externalId,
    handle: s.handle,
    trustWeight: s.trustWeight,
    notes: s.notes ?? null,
    status: 'active' as const,
  }));
  const result = await db
    .insert(creatorProfiles)
    .values(rows)
    .onConflictDoUpdate({
      target: [creatorProfiles.platform, creatorProfiles.externalId],
      set: {
        handle: sql`excluded.handle`,
        trustWeight: sql`excluded.trust_weight`,
        notes: sql`excluded.notes`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: creatorProfiles.id });

  let disabledStale = 0;
  for (const seed of CREATOR_SEEDS) {
    const stale = await db
      .update(creatorProfiles)
      .set({
        status: 'disabled',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(creatorProfiles.platform, seed.platform),
          eq(creatorProfiles.handle, seed.handle),
          sql`${creatorProfiles.externalId} <> ${seed.externalId}`,
        ),
      )
      .returning({ id: creatorProfiles.id });
    disabledStale += stale.length;
  }

  return { upserted: result.length, disabledStale };
}

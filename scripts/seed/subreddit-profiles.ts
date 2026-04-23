/**
 * Seed `subreddit_profiles` — Reddit communities we search and poll for
 * phone discussion. General subs cover the full catalog; device-scoped subs
 * surface launch/owner threads that general subs downrank.
 */
import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { subredditProfiles } from '../../src/services/db/schema';

export interface SubredditSeed {
  name: string;
  scope: 'general' | 'device';
  minScore: number;
  trustWeight: string;
}

export const SUBREDDIT_SEEDS: readonly SubredditSeed[] = [
  // General / cross-brand subs.
  { name: 'Android', scope: 'general', minScore: 40, trustWeight: '0.80' },
  { name: 'apple', scope: 'general', minScore: 40, trustWeight: '0.80' },
  { name: 'iphone', scope: 'general', minScore: 30, trustWeight: '0.75' },
  { name: 'Smartphones', scope: 'general', minScore: 20, trustWeight: '0.70' },
  { name: 'PickAnAndroidForMe', scope: 'general', minScore: 10, trustWeight: '0.65' },

  // Brand-focused subs (moderate scope, high signal for their brand).
  { name: 'GooglePixel', scope: 'general', minScore: 20, trustWeight: '0.85' },
  { name: 'OnePlus', scope: 'general', minScore: 20, trustWeight: '0.80' },
  { name: 'nothingtech', scope: 'general', minScore: 15, trustWeight: '0.75' },
  { name: 'Xiaomi', scope: 'general', minScore: 20, trustWeight: '0.70' },
  { name: 'MotorolaLenovo', scope: 'general', minScore: 15, trustWeight: '0.70' },
  { name: 'Asus_ROG', scope: 'general', minScore: 15, trustWeight: '0.70' },

  // Device-scoped subs (narrow, high relevance within their family).
  { name: 'GalaxyS25', scope: 'device', minScore: 15, trustWeight: '0.85' },
  { name: 'Pixel9', scope: 'device', minScore: 15, trustWeight: '0.85' },
  { name: 'OnePlus13', scope: 'device', minScore: 10, trustWeight: '0.80' },
  { name: 'NothingPhone', scope: 'device', minScore: 10, trustWeight: '0.80' },
];

export async function seedSubredditProfiles(
  db: PostgresJsDatabase<Record<string, never>>,
): Promise<{ upserted: number }> {
  if (SUBREDDIT_SEEDS.length === 0) return { upserted: 0 };
  const rows = SUBREDDIT_SEEDS.map((s) => ({
    name: s.name,
    scope: s.scope,
    minScore: s.minScore,
    trustWeight: s.trustWeight,
    status: 'active' as const,
  }));
  const result = await db
    .insert(subredditProfiles)
    .values(rows)
    .onConflictDoUpdate({
      target: subredditProfiles.name,
      set: {
        scope: sql`excluded.scope`,
        minScore: sql`excluded.min_score`,
        trustWeight: sql`excluded.trust_weight`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: subredditProfiles.id });
  return { upserted: result.length };
}

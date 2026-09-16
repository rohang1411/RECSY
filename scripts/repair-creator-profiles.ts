#!/usr/bin/env tsx
/**
 * Repair and verify creator profiles in the database.
 *
 * Ensures all trusted tech channels (MKBHD, Mrwhosetheboss, etc.)
 * have active, valid YouTube channel IDs with working RSS feeds, and disables
 * stale or dead feeds.
 *
 * Usage:
 *   pnpm exec tsx --env-file=.env.local scripts/repair-creator-profiles.ts
 */
import { getDb } from '../src/services/db/client';
import { creatorProfiles } from '../src/services/db/schema';
import { seedCreatorProfiles } from './seed/creator-profiles';

async function main(): Promise<void> {
  const db = getDb();

  console.log('[repair-creator-profiles] seeding and updating creator profiles...');
  const { upserted, disabledStale } = await seedCreatorProfiles(db);
  console.log(`[repair-creator-profiles] upserted: ${upserted}, disabled stale: ${disabledStale}`);

  const rows = await db.select().from(creatorProfiles);
  console.log(`[repair-creator-profiles] found ${rows.length} total rows in creator_profiles:`);

  for (const row of rows) {
    if (row.platform === 'youtube') {
      const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(row.externalId)}`;
      try {
        const res = await fetch(url, {
          headers: { 'user-agent': 'RECSYBot/0.1 (creator-feed-verify)' },
        });
        console.log(`  - [${row.status}] ${row.handle} (${row.externalId}): HTTP ${res.status}`);
      } catch (err) {
        console.log(`  - [${row.status}] ${row.handle} (${row.externalId}): fetch error ${err}`);
      }
    } else {
      console.log(`  - [${row.status}] ${row.platform}:${row.handle}`);
    }
  }

  console.log('[repair-creator-profiles] done.');
  process.exit(0);
}

main().catch((err) => {
  console.error('[repair-creator-profiles] error:', err);
  process.exit(1);
});

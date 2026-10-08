#!/usr/bin/env tsx
/**
 * Sync canonical mainstream flagships into RECSY database.
 *
 * Ensures all top devices from Apple, Samsung, Google, OnePlus, Nothing, etc.
 * from the past 3-4 years are guaranteed to be present with verified specifications.
 *
 * Usage:
 *   pnpm catalog:sync-flagships
 */
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { syncMissingFlagships } from '../src/services/catalog/flagship-registry';

async function main(): Promise<void> {
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'phones' },
    { table: 'phone_aliases' },
    { table: 'catalog_candidates' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:sync-flagships', missing));
    process.exit(0);
  }

  console.log('[catalog:sync-flagships] Checking and syncing canonical mainstream flagships...');
  const result = await syncMissingFlagships(db);

  console.log(
    `[catalog:sync-flagships] Done. Added: ${result.added.length} | Verified/Updated: ${result.updated.length}`,
  );
  if (result.added.length > 0) {
    console.log('Newly added flagships:');
    for (const slug of result.added) {
      console.log(`  + ${slug}`);
    }
  }
}

main().catch((err) => {
  console.error('[catalog:sync-flagships] FAILED:', err);
  process.exit(1);
});

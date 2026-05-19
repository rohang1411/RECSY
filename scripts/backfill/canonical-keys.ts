#!/usr/bin/env tsx
/**
 * Backfill legacy phone catalog identity fields.
 *
 * Purpose: make the existing seeded `phones` rows matchable by the automated
 * catalog pipeline before the first scheduled refresh. This script performs no
 * LLM calls and does not fetch the network.
 *
 * Usage:
 *   pnpm catalog:backfill-identities
 *   pnpm catalog:backfill-identities --dry-run
 */
import { eq, sql } from 'drizzle-orm';

import { buildCanonicalKey } from '../../src/services/catalog';
import { getDb } from '../../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../../src/services/db/schema-guard';
import { phoneIdentities, phones } from '../../src/services/db/schema';

interface CliArgs {
  readonly dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let dryRun = false;
  for (const flag of argv) {
    switch (flag) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        console.error(`[catalog:backfill-identities] Unknown flag: ${flag}\n`);
        printUsage();
        process.exit(2);
    }
  }
  return { dryRun };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'phones', columns: ['canonical_key', 'catalog_last_seen_at'] },
    { table: 'phone_identities' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:backfill-identities', missing));
    process.exit(0);
  }

  const rows = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      launchDate: phones.launchDate,
      status: phones.status,
    })
    .from(phones);

  const byKey = new Map<string, string[]>();
  const planned = rows.map((row) => {
    const canonicalKey = buildCanonicalKey({
      brand: row.brand,
      model: row.model,
      launchDate: row.launchDate,
    });
    const slugs = byKey.get(canonicalKey) ?? [];
    slugs.push(row.slug);
    byKey.set(canonicalKey, slugs);
    return { ...row, canonicalKey };
  });

  const duplicates = [...byKey.entries()].filter(([, slugs]) => slugs.length > 1);
  if (duplicates.length > 0) {
    console.error('[catalog:backfill-identities] duplicate canonical keys detected:');
    for (const [key, slugs] of duplicates) {
      console.error(`  ${key}: ${slugs.join(', ')}`);
    }
    process.exit(1);
  }

  if (args.dryRun) {
    console.log(
      `[catalog:backfill-identities] dry-run phones=${planned.length} identities=${planned.length * 2} llm_calls=0`,
    );
    return;
  }

  let updated = 0;
  let identities = 0;
  const now = new Date();
  for (const row of planned) {
    await db
      .update(phones)
      .set({
        canonicalKey: row.canonicalKey,
        catalogLastSeenAt: now,
        lastCatalogRefreshAt: now,
        metadataConfidence: '0.70',
        specCompleteness: '1.00',
        updatedAt: sql`now()`,
      })
      .where(eq(phones.id, row.id));
    updated += 1;

    const identityRows = [
      {
        phoneId: row.id,
        sourceKey: 'recsy_seed',
        externalId: row.slug,
        identityType: 'legacy_slug' as const,
        confidence: '1.00',
      },
      {
        phoneId: row.id,
        sourceKey: 'recsy_seed',
        externalId: row.canonicalKey,
        identityType: 'canonical_key' as const,
        confidence: '0.95',
      },
    ];

    const result = await db
      .insert(phoneIdentities)
      .values(identityRows)
      .onConflictDoUpdate({
        target: [phoneIdentities.sourceKey, phoneIdentities.externalId],
        set: {
          phoneId: sql`excluded.phone_id`,
          identityType: sql`excluded.identity_type`,
          confidence: sql`excluded.confidence`,
          lastSeenAt: sql`now()`,
        },
      })
      .returning({ id: phoneIdentities.id });
    identities += result.length;
  }

  console.log(
    `[catalog:backfill-identities] done phones=${updated} identities=${identities} llm_calls=0`,
  );
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:backfill-identities [options]',
      '',
      'Options:',
      '  --dry-run   Validate and report planned updates without writing',
      '  --help      Print this message',
    ].join('\n'),
  );
}

main().catch((err) => {
  console.error('[catalog:backfill-identities] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

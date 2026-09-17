#!/usr/bin/env tsx
/**
 * Backfill clean, high-resolution smartphone studio renders locally.
 *
 * Sourcing:
 *   Resolves studio images via `resolveStudioImageCandidate` (curated maps,
 *   algorithmic GSMArena CDN bigpic matching, brand catalog crawling),
 *   downloads them to `public/phones/[slug].jpg`, computes SHA-256 hashes,
 *   and updates both `phones` and `phone_media_assets`.
 *
 * Usage:
 *   pnpm catalog:backfill-images
 *   pnpm catalog:backfill-images --slug apple-iphone-16-pro
 *   pnpm catalog:backfill-images --force
 *   pnpm catalog:backfill-images --dry-run
 */
import { eq, sql } from 'drizzle-orm';

import { downloadAndSavePhoneImage, resolveStudioImageCandidate } from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { phones } from '../src/services/db/schema';

interface CliArgs {
  readonly limit: number;
  readonly slug: string | null;
  readonly force: boolean;
  readonly dryRun: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args = {
    limit: 100,
    slug: null as string | null,
    force: false,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--limit':
        args.limit = Math.max(1, parseInt(argv[++i] ?? '100', 10) || 100);
        break;
      case '--slug':
        args.slug = argv[++i] ?? null;
        break;
      case '--force':
        args.force = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown flag: ${flag}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`
Usage: tsx scripts/catalog-backfill-gsmarena-images.ts [options]

Options:
  --slug <slug>   Process a single phone by slug
  --limit <n>     Max phones to process (default: 100)
  --force         Force re-download even if local image or local_ok already exists
  --dry-run       Preview resolved image candidates without downloading or updating DB
  --help, -h      Show this help message
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  const missing = await findMissingPublicSchema(db, [
    { table: 'phones', columns: ['image_url', 'media_status'] },
    { table: 'phone_media_assets' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:backfill-images', missing));
    process.exit(0);
  }

  const query = db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      imageUrl: phones.imageUrl,
      mediaStatus: phones.mediaStatus,
      specJson: phones.specJson,
    })
    .from(phones);

  let targetPhones;
  if (args.slug) {
    targetPhones = await query.where(eq(phones.slug, args.slug)).limit(1);
  } else if (args.force) {
    targetPhones = await query
      .where(sql`${phones.status} in ('active', 'upcoming')`)
      .limit(args.limit);
  } else {
    targetPhones = await query
      .where(
        sql`${phones.status} in ('active', 'upcoming')
          and (
            ${phones.imageUrl} is null
            or ${phones.imageUrl} = ''
            or ${phones.mediaStatus} is null
            or ${phones.mediaStatus} != 'local_ok'
            or ${phones.imageUrl} not like '/phones/%'
          )`,
      )
      .limit(args.limit);
  }

  if (targetPhones.length === 0) {
    console.log(
      '[catalog:backfill-images] All phones already have local studio imagery. Use --force to re-check.',
    );
    return;
  }

  console.log(`[catalog:backfill-images] Processing ${targetPhones.length} phones...`);

  let resolvedCount = 0;
  let downloadedCount = 0;
  let alreadyExistedCount = 0;
  let failedCount = 0;

  for (const phone of targetPhones) {
    try {
      const candidate = await resolveStudioImageCandidate(phone);
      if (!candidate) {
        console.warn(
          `[catalog:backfill-images] [MISS] No studio image candidate found for: ${phone.brand} ${phone.model} (${phone.slug})`,
        );
        failedCount++;
        continue;
      }

      resolvedCount++;
      console.log(
        `[catalog:backfill-images] [RESOLVED] ${phone.slug} -> ${candidate.imageUrl} (${candidate.notes ?? candidate.sourceKey})`,
      );

      if (args.dryRun) {
        continue;
      }

      const result = await downloadAndSavePhoneImage(phone, candidate, {
        force: args.force,
        db,
      });

      if (result.alreadyExisted) {
        alreadyExistedCount++;
        console.log(
          `[catalog:backfill-images] [LOCAL_OK] ${phone.slug} already present at ${result.localPublicUrl} (${result.bytes} bytes)`,
        );
      } else {
        downloadedCount++;
        console.log(
          `[catalog:backfill-images] [SAVED] ${phone.slug} -> ${result.localPublicUrl} (${result.bytes} bytes, sha: ${result.sha256.slice(0, 8)}...)`,
        );
      }
    } catch (err) {
      failedCount++;
      console.error(
        `[catalog:backfill-images] [ERROR] Failed processing ${phone.slug}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log('\n[catalog:backfill-images] Finished summary:');
  console.log(`  Total targeted   : ${targetPhones.length}`);
  console.log(`  Resolved         : ${resolvedCount}`);
  console.log(`  Newly downloaded : ${downloadedCount}`);
  console.log(`  Already existing : ${alreadyExistedCount}`);
  console.log(`  Failed / Missing : ${failedCount}`);
}

main().catch((err) => {
  console.error('[catalog:backfill-images] Fatal error:', err);
  process.exit(1);
});

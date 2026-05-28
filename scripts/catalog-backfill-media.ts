#!/usr/bin/env tsx
/**
 * Backfill missing phone images from trusted catalog discovery sources.
 *
 * This is intentionally conservative: it only writes a phone image when a
 * source candidate matches the existing catalog row by brand and exact model,
 * and the remote URL still serves an image.
 */
import { eq, sql } from 'drizzle-orm';

import {
  extractOemProductPage,
  findWikidataPhonesByName,
  fetchOemPageHtml,
  needsPhoneMediaBackfill,
  selectPhoneMediaCandidate,
  sha256Hex,
  validateRemoteImageUrl,
} from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import {
  catalogCandidates,
  catalogQualityIssues,
  catalogRuns,
  catalogSourceClaims,
  phoneMediaAssets,
  phones,
} from '../src/services/db/schema';

interface CliArgs {
  readonly limit: number;
  readonly dryRun: boolean;
  readonly minRequestGapMs: number;
  readonly lookupLimit: number;
}

type PhoneRow = typeof phones.$inferSelect;

function parseArgs(argv: readonly string[]): CliArgs {
  const args = {
    limit: 50,
    dryRun: false,
    minRequestGapMs: 1_250,
    lookupLimit: 8,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--limit':
        args.limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--min-request-gap-ms':
        args.minRequestGapMs = parsePositiveInt(argv[++i], '--min-request-gap-ms');
        break;
      case '--lookup-limit':
        args.lookupLimit = parsePositiveInt(argv[++i], '--lookup-limit');
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${flag}`);
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'catalog_runs' },
    { table: 'phones', columns: ['image_url', 'media_status'] },
    { table: 'phone_media_assets' },
    { table: 'catalog_source_claims' },
    { table: 'catalog_quality_issues' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:backfill-media', missing));
    process.exit(0);
  }

  const candidates = await db
    .select()
    .from(phones)
    .where(
      sql`${phones.status} in ('active', 'upcoming')
        and (
          ${phones.imageUrl} is null
          or ${phones.imageUrl} = ''
          or ${phones.mediaStatus} is null
          or ${phones.mediaStatus} in ('missing', 'blocked')
        )`,
    )
    .orderBy(
      sql`case when ${phones.imageUrl} is null or ${phones.imageUrl} = '' then 0 else 1 end`,
      sql`coalesce(${phones.lastCatalogRefreshAt}, '1970-01-01'::timestamptz) asc`,
    )
    .limit(args.limit);

  if (candidates.length === 0) {
    console.log('[catalog:backfill-media] no phones need media backfill');
    return;
  }

  const startedAt = Date.now();
  const run = args.dryRun
    ? null
    : (
        await db
          .insert(catalogRuns)
          .values({
            kind: 'scheduled',
            status: 'running',
            stage: 'media_backfill',
            maxRequests: candidates.length,
            maxLlmCalls: 0,
            checkpointJson: {
              limit: args.limit,
              lookupLimit: args.lookupLimit,
              source: 'wikidata',
            },
          })
          .returning({ id: catalogRuns.id })
      )[0];
  if (!args.dryRun && !run) throw new Error('catalog run insert returned no row');

  let checked = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    for (const phone of candidates) {
      if (checked > 0) await sleep(args.minRequestGapMs);
      checked += 1;

      const existing = phone.imageUrl?.trim();
      if (existing) {
        const existingValidation = await validateRemoteImageUrl(existing);
        if (existingValidation.ok) {
          if (!args.dryRun) {
            await markExistingImageOk(db, phone, existing);
          }
          updated += 1;
          console.log(`[catalog:backfill-media] ok existing ${phone.slug} ${existing}`);
          continue;
        }

        if (!args.dryRun) {
          await recordImageIssue(db, phone.id, 'image_url_unreachable', {
            imageUrl: existing,
            status: existingValidation.status,
            reason: existingValidation.reason,
          });
        }
      }

      if (!needsPhoneMediaBackfill(phone)) {
        skipped += 1;
        continue;
      }

      const stagedCandidates = await readStagedImageCandidates(db, phone);
      let selected = selectPhoneMediaCandidate(phone, stagedCandidates);
      if (!selected && stagedCandidates.length > 0) {
        console.log(`[catalog:backfill-media] staged candidates had no exact image ${phone.slug}`);
      }

      if (!selected) {
        const oemCandidates = await readOemImageCandidates(phone, stagedCandidates);
        selected = selectPhoneMediaCandidate(phone, oemCandidates);
      }

      const wikidataCandidates = selected
        ? []
        : await findWikidataPhonesByName({
            brand: phone.brand,
            model: phone.model,
            limit: args.lookupLimit,
          });
      selected ??= selectPhoneMediaCandidate(phone, wikidataCandidates);
      if (!selected) {
        skipped += 1;
        console.log(`[catalog:backfill-media] no exact image match ${phone.slug}`);
        continue;
      }

      const validation = await validateRemoteImageUrl(selected.imageUrl);
      if (!validation.ok) {
        failed += 1;
        if (!args.dryRun) {
          await recordImageIssue(db, phone.id, 'candidate_image_unreachable', {
            imageUrl: selected.imageUrl,
            sourceKey: selected.sourceKey,
            sourceUrl: selected.sourceUrl,
            status: validation.status,
            reason: validation.reason,
          });
        }
        console.log(
          `[catalog:backfill-media] rejected ${phone.slug} ${selected.imageUrl} ${validation.reason ?? ''}`,
        );
        continue;
      }

      if (!args.dryRun) {
        await writeImageBackfill(db, phone, selected);
      }
      updated += 1;
      console.log(
        `[catalog:backfill-media] updated ${phone.slug} image=${selected.imageUrl} source=${selected.sourceKey} reason=${selected.matchReason}`,
      );
    }

    if (run) {
      await db
        .update(catalogRuns)
        .set({
          status: failed > 0 ? 'partial' : 'success',
          stage: 'done',
          updatedCount: updated,
          skippedCount: skipped,
          quarantinedCount: failed,
          requestCount: checked,
          llmCallCount: 0,
          finishedAt: sql`now()`,
          durationMs: Date.now() - startedAt,
        })
        .where(eq(catalogRuns.id, run.id));
    }

    console.log(
      `[catalog:backfill-media] done checked=${checked} updated=${updated} skipped=${skipped} failed=${failed} llm_calls=0`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(catalogRuns)
        .set({
          status: 'failed',
          error: message.slice(0, 2_000),
          errorCode: 'unknown',
          finishedAt: sql`now()`,
          durationMs: Date.now() - startedAt,
        })
        .where(eq(catalogRuns.id, run.id));
    }
    throw err;
  }
}

async function readStagedImageCandidates(
  db: ReturnType<typeof getDb>,
  phone: PhoneRow,
): Promise<
  {
    readonly sourceKey: string;
    readonly sourceUrl: string | null;
    readonly externalId: string | null;
    readonly brand: string | null;
    readonly model: string | null;
    readonly title: string;
    readonly imageUrl: string | null;
    readonly officialUrl: string | null;
    readonly aliases: readonly string[];
  }[]
> {
  const fullName = `${phone.brand} ${phone.model}`.toLowerCase();
  const model = phone.model.toLowerCase();
  const rows = await db
    .select({
      sourceKey: catalogCandidates.sourceKey,
      sourceUrl: catalogCandidates.sourceUrl,
      externalId: catalogCandidates.externalId,
      title: catalogCandidates.candidateTitle,
      raw: catalogCandidates.rawCandidateJson,
      normalized: catalogCandidates.normalizedIdentityJson,
    })
    .from(catalogCandidates)
    .where(
      sql`${catalogCandidates.sourceKey} = 'wikidata'
        and (
          ${catalogCandidates.canonicalKey} = ${phone.canonicalKey}
          or lower(${catalogCandidates.candidateTitle}) = ${fullName}
          or lower(${catalogCandidates.candidateTitle}) = ${model}
        )`,
    )
    .limit(10);

  return rows.map((row) => ({
    sourceKey: row.sourceKey,
    sourceUrl: row.sourceUrl,
    externalId: row.externalId,
    title: row.title,
    brand: stringValue(row.normalized, 'brand'),
    model: stringValue(row.normalized, 'model') ?? row.title,
    imageUrl: stringValue(row.raw, 'image'),
    officialUrl: stringValue(row.normalized, 'officialUrl'),
    aliases: arrayValue(row.normalized, 'aliases'),
  }));
}

async function readOemImageCandidates(
  phone: PhoneRow,
  stagedCandidates: readonly { readonly officialUrl: string | null }[],
): Promise<
  {
    readonly sourceKey: string;
    readonly sourceUrl: string | null;
    readonly externalId: string | null;
    readonly brand: string | null;
    readonly model: string | null;
    readonly title: string;
    readonly imageUrl: string | null;
    readonly aliases: readonly string[];
  }[]
> {
  const urls = [
    phone.officialUrl,
    ...stagedCandidates.map((candidate) => candidate.officialUrl),
  ].filter((url): url is string => Boolean(url && isLikelyOfficialHttpsUrl(url)));

  const candidates = [];
  for (const url of [...new Set(urls)].slice(0, 2)) {
    try {
      const html = await fetchOemPageHtml({ url });
      const record = extractOemProductPage({
        url,
        html,
        fallbackBrand: phone.brand,
        fallbackModel: phone.model,
      });
      candidates.push({
        sourceKey: record.sourceKey,
        sourceUrl: record.sourceUrl ?? null,
        externalId: record.externalId ?? null,
        brand: record.brand,
        model: record.model,
        title: `${record.brand} ${record.model}`,
        imageUrl: record.imageUrl ?? null,
        aliases: record.aliases,
      });
    } catch (err) {
      console.log(
        `[catalog:backfill-media] OEM image lookup failed ${phone.slug} ${url}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return candidates;
}

async function markExistingImageOk(
  db: ReturnType<typeof getDb>,
  phone: PhoneRow,
  imageUrl: string,
): Promise<void> {
  await db
    .update(phones)
    .set({
      mediaStatus: 'remote_only',
      catalogLastSeenAt: sql`now()`,
      lastCatalogRefreshAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(phones.id, phone.id));

  await upsertMediaAsset(db, {
    phoneId: phone.id,
    sourceKey: 'existing_catalog',
    imageUrl,
    sourceUrl: null,
  });
}

async function writeImageBackfill(
  db: ReturnType<typeof getDb>,
  phone: PhoneRow,
  selected: {
    readonly imageUrl: string;
    readonly sourceKey: string;
    readonly sourceUrl: string | null;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(phones)
      .set({
        imageUrl: selected.imageUrl,
        mediaStatus: 'remote_only',
        catalogLastSeenAt: sql`now()`,
        lastCatalogRefreshAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(phones.id, phone.id));

    await upsertMediaAsset(tx, {
      phoneId: phone.id,
      sourceKey: selected.sourceKey,
      imageUrl: selected.imageUrl,
      sourceUrl: selected.sourceUrl,
    });

    await tx.insert(catalogSourceClaims).values({
      phoneId: phone.id,
      sourceKey: selected.sourceKey,
      sourceUrl: selected.sourceUrl,
      fieldPath: 'image_url',
      valueJson: selected.imageUrl,
      confidence: '0.90',
      trustWeight: '0.80',
      contentHash: sha256Hex(selected.imageUrl),
      isCurrent: true,
    });
  });
}

async function upsertMediaAsset(
  db: Pick<ReturnType<typeof getDb>, 'insert'>,
  input: {
    readonly phoneId: string;
    readonly sourceKey: string;
    readonly imageUrl: string;
    readonly sourceUrl: string | null;
  },
): Promise<void> {
  await db
    .insert(phoneMediaAssets)
    .values({
      phoneId: input.phoneId,
      sourceKey: input.sourceKey,
      originUrl: input.sourceUrl ?? input.imageUrl,
      publicUrl: input.imageUrl,
      sha256: sha256Hex(input.imageUrl),
      rightsStatus: 'remote_only',
      isPrimary: true,
      status: 'active',
      lastCheckedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [phoneMediaAssets.phoneId, phoneMediaAssets.sha256],
      set: {
        publicUrl: input.imageUrl,
        rightsStatus: 'remote_only',
        isPrimary: true,
        status: 'active',
        lastCheckedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

async function recordImageIssue(
  db: ReturnType<typeof getDb>,
  phoneId: string,
  code: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db.insert(catalogQualityIssues).values({
    phoneId,
    severity: 'warn',
    code,
    message: JSON.stringify(detail).slice(0, 1_500),
    fieldPath: 'image_url',
    sourceKey: typeof detail.sourceKey === 'string' ? detail.sourceKey : null,
  });
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function arrayValue(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function isLikelyOfficialHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !NON_OFFICIAL_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

const NON_OFFICIAL_HOST_RE =
  /gsmarena\.com|phonearena\.com|kimovil\.com|notebookcheck|reddit\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|facebook\.com|tiktok\.com|amazon\.com|bestbuy\.com|walmart\.com|ebay\.com|flipkart\.com|wikidata\.org|wikipedia\.org|api\.mobileapi\.dev|commons\.wikimedia\.org/i;

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:backfill-media [options]',
      '',
      'Options:',
      '  --limit N              Max phones to check (default: 50)',
      '  --lookup-limit N       Max Wikidata matches to inspect per phone (default: 8)',
      '  --min-request-gap-ms N Delay between phones (default: 1250)',
      '  --dry-run              Validate and print without DB writes',
      '  --help                 Print this message',
    ].join('\n'),
  );
}

function exitWithUsage(message: string): never {
  console.error(`[catalog:backfill-media] ${message}\n`);
  printUsage();
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[catalog:backfill-media] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

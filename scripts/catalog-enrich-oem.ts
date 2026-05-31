#!/usr/bin/env tsx
/**
 * Enrich catalog candidates from official OEM product pages.
 *
 * This no-LLM path fetches official manufacturer pages, extracts JSON-LD/meta
 * and visible spec text, validates the strict PhoneSpec promotion contract, and
 * optionally promotes valid records into `phones`.
 *
 * Usage:
 *   pnpm catalog:enrich-oem --url https://example.com/product/phone --dry-run
 *   pnpm catalog:enrich-oem --from-candidates --limit 25 --promote --update-existing
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';

import {
  buildCanonicalKey,
  buildPromotionPlan,
  compareCatalogPriorityThenNewest,
  extractOemProductPage,
  fetchOemPageHtml,
  hashJson,
  isLikelyCatalogPhoneTitle,
  isReleasedCatalogCandidate,
  promoteCatalogCandidate,
  stableCandidateKey,
} from '../src/services/catalog';
import type { CatalogImportRecord } from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';

interface CliArgs {
  readonly url: string | null;
  readonly fromCandidates: boolean;
  readonly limit: number;
  readonly dryRun: boolean;
  readonly promote: boolean;
  readonly updateExisting: boolean;
  readonly minRequestGapMs: number;
}

interface CandidateSeed {
  readonly candidateId?: string;
  readonly url: string;
  readonly fallbackBrand?: string | null;
  readonly fallbackModel?: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: {
    url: string | null;
    fromCandidates: boolean;
    limit: number;
    dryRun: boolean;
    promote: boolean;
    updateExisting: boolean;
    minRequestGapMs: number;
  } = {
    url: null,
    fromCandidates: false,
    limit: 25,
    dryRun: false,
    promote: false,
    updateExisting: false,
    minRequestGapMs: 2_000,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--url':
        args.url = argv[++i] ?? null;
        break;
      case '--from-candidates':
        args.fromCandidates = true;
        break;
      case '--limit':
        args.limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--promote':
        args.promote = true;
        break;
      case '--update-existing':
        args.updateExisting = true;
        break;
      case '--min-request-gap-ms':
        args.minRequestGapMs = parsePositiveInt(argv[++i], '--min-request-gap-ms');
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${flag}`);
    }
  }

  if (!args.url && !args.fromCandidates) {
    exitWithUsage('one of --url or --from-candidates is required');
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'catalog_runs' },
    { table: 'catalog_candidates' },
    { table: 'phones', columns: ['canonical_key', 'catalog_last_seen_at'] },
    { table: 'phone_identities' },
    { table: 'phone_aliases' },
    { table: 'phone_configurations' },
    { table: 'catalog_source_claims' },
    { table: 'phone_media_assets' },
    { table: 'catalog_quality_issues' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:enrich-oem', missing));
    process.exit(0);
  }

  const seeds = args.url ? [{ url: args.url }] : await readCandidateSeeds(db, args.limit);
  if (seeds.length === 0) {
    console.log('[catalog:enrich-oem] no candidates with official OEM URLs found llm_calls=0');
    return;
  }

  const startedAt = Date.now();
  const run = args.dryRun
    ? null
    : (
        await db
          .insert(catalogRuns)
          .values({
            kind: 'manual',
            status: 'running',
            stage: args.promote ? 'oem_enrich_promote' : 'oem_enrich',
            maxRequests: args.limit,
            maxLlmCalls: 0,
            checkpointJson: {
              urls: seeds.map((seed) => seed.url),
              promote: args.promote,
              updateExisting: args.updateExisting,
            },
          })
          .returning({ id: catalogRuns.id })
      )[0];
  if (!args.dryRun && !run) throw new Error('catalog run insert returned no row');

  let fetched = 0;
  let created = 0;
  let updated = 0;
  let valid = 0;
  let quarantined = 0;
  let promoted = 0;

  try {
    for (const seed of seeds) {
      if (fetched > 0) {
        await sleep(args.minRequestGapMs);
      }
      const html = await fetchOemPageHtml({ url: seed.url });
      fetched += 1;
      const record = extractOemProductPage({
        url: seed.url,
        html,
        fallbackBrand: seed.fallbackBrand,
        fallbackModel: seed.fallbackModel,
      });
      const item = stagePlan(record);
      if (item.plan.ok) valid += 1;

      if (args.dryRun) {
        const state = item.plan.ok
          ? 'valid'
          : `blocked:${item.plan.issues[0]?.code ?? 'unknown'} ${formatIssueSummary(item.plan.issues)}`;
        console.log(`  ${state} ${record.brand} ${record.model} ${seed.url}`);
        continue;
      }

      if (!run) throw new Error('catalog run insert returned no row');
      const prior = await db
        .select({ id: catalogCandidates.id })
        .from(catalogCandidates)
        .where(eq(catalogCandidates.stableKey, item.stableKey))
        .limit(1);
      if (prior.length === 0) created += 1;
      else updated += 1;

      const [candidate] = await db
        .insert(catalogCandidates)
        .values({
          firstRunId: run.id,
          lastRunId: run.id,
          stableKey: item.stableKey,
          sourceKey: item.record.sourceKey,
          sourceType: item.record.sourceType,
          externalId: item.externalId,
          sourceUrl: item.record.sourceUrl ?? null,
          candidateTitle: `${item.record.brand} ${item.record.model}`,
          rawCandidateJson: item.record.raw,
          normalizedIdentityJson: {
            brand: item.record.brand,
            model: item.record.model,
            launchDate: item.record.launchDate ?? null,
            aliases: item.record.aliases,
            enrichedFromCandidateId: seed.candidateId ?? null,
          },
          claimsJson: item.claimsJson,
          canonicalKey: item.canonicalKey,
          contentHash: hashJson(item.claimsJson),
          decision: item.plan.ok ? 'promote' : 'quarantine',
          status: item.plan.ok ? 'ready_to_promote' : 'quarantined',
          confidence: item.plan.ok ? '0.95' : '0.00',
          issueCodes: item.plan.ok ? [] : [...new Set(item.plan.issues.map((issue) => issue.code))],
          lastDecisionAt: new Date(),
        })
        .onConflictDoUpdate({
          target: catalogCandidates.stableKey,
          set: {
            lastRunId: sql`excluded.last_run_id`,
            sourceUrl: sql`excluded.source_url`,
            candidateTitle: sql`excluded.candidate_title`,
            rawCandidateJson: sql`excluded.raw_candidate_json`,
            normalizedIdentityJson: sql`excluded.normalized_identity_json`,
            claimsJson: sql`excluded.claims_json`,
            canonicalKey: sql`excluded.canonical_key`,
            contentHash: sql`excluded.content_hash`,
            decision: sql`excluded.decision`,
            status: sql`excluded.status`,
            confidence: sql`excluded.confidence`,
            issueCodes: sql`excluded.issue_codes`,
            seenCount: sql`${catalogCandidates.seenCount} + 1`,
            lastDecisionAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: catalogCandidates.id });
      if (!candidate) throw new Error('candidate upsert returned no row');

      if (!item.plan.ok) {
        quarantined += 1;
        continue;
      }
      if (args.promote) {
        const result = await promoteCatalogCandidate(db, candidate.id, {
          updateExisting: args.updateExisting,
        });
        if (result.action === 'created' || result.action === 'updated') promoted += 1;
        if (result.action === 'blocked') quarantined += 1;
      }
    }

    if (args.dryRun) {
      console.log(
        `[catalog:enrich-oem] dry-run fetched=${fetched} valid=${valid} blocked=${fetched - valid} llm_calls=0`,
      );
      return;
    }

    if (!run) throw new Error('catalog run insert returned no row');
    await db
      .update(catalogRuns)
      .set({
        status: 'success',
        stage: 'done',
        createdCount: created,
        updatedCount: updated + promoted,
        quarantinedCount: quarantined,
        requestCount: fetched,
        llmCallCount: 0,
        finishedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(catalogRuns.id, run.id));

    console.log(
      `[catalog:enrich-oem] done fetched=${fetched} created=${created} updated=${updated} valid=${valid} promoted=${promoted} quarantined=${quarantined} llm_calls=0`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(catalogRuns)
        .set({
          status: 'failed',
          requestCount: fetched,
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

async function readCandidateSeeds(
  db: ReturnType<typeof getDb>,
  limit: number,
): Promise<CandidateSeed[]> {
  const rows = await db
    .select({
      id: catalogCandidates.id,
      title: catalogCandidates.candidateTitle,
      sourceUrl: catalogCandidates.sourceUrl,
      raw: catalogCandidates.rawCandidateJson,
      normalized: catalogCandidates.normalizedIdentityJson,
    })
    .from(catalogCandidates)
    .where(
      and(
        inArray(catalogCandidates.status, ['discovered', 'quarantined', 'failed']),
        isNotNull(catalogCandidates.rawCandidateJson),
      ),
    )
    .orderBy(desc(catalogCandidates.updatedAt))
    .limit(Math.max(limit * 20, 100));

  const sortedRows = rows
    .filter((row) =>
      isLikelyCatalogPhoneTitle(
        [row.title, stringValue(row.normalized.model)].filter(Boolean).join(' '),
      ),
    )
    .filter((row) =>
      isReleasedCatalogCandidate({
        brand: stringValue(row.normalized.brand),
        model: stringValue(row.normalized.model),
        title: row.title,
        launchDate: stringValue(row.normalized.launchDate),
        releaseDate: stringValue(row.normalized.releaseDate) ?? stringValue(row.raw.releaseDate),
        releasedAt: stringValue(row.raw.releasedAt),
      }),
    )
    .sort((a, b) =>
      compareCatalogPriorityThenNewest(
        {
          brand: stringValue(a.normalized.brand),
          model: stringValue(a.normalized.model),
          title: a.title,
          launchDate: stringValue(a.normalized.launchDate),
          releaseDate: stringValue(a.normalized.releaseDate) ?? stringValue(a.raw.releaseDate),
        },
        {
          brand: stringValue(b.normalized.brand),
          model: stringValue(b.normalized.model),
          title: b.title,
          launchDate: stringValue(b.normalized.launchDate),
          releaseDate: stringValue(b.normalized.releaseDate) ?? stringValue(b.raw.releaseDate),
        },
      ),
    );

  const seeds: CandidateSeed[] = [];
  const seen = new Set<string>();
  for (const row of sortedRows) {
    const url = bestOfficialUrlFromCandidate(row.raw, row.normalized, row.sourceUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    seeds.push({
      candidateId: row.id,
      url,
      fallbackBrand: stringValue(row.normalized.brand),
      fallbackModel: stringValue(row.normalized.model),
    });
    if (seeds.length >= limit) break;
  }
  return seeds;
}

function stagePlan(record: CatalogImportRecord) {
  const externalId =
    record.externalId ?? record.officialUrl ?? record.sourceUrl ?? fallbackExternalId(record);
  const canonicalKey = buildCanonicalKey({
    brand: record.brand,
    model: record.model,
    launchDate: record.launchDate,
  });
  const stableKey = stableCandidateKey({
    sourceKey: record.sourceKey,
    externalId,
    sourceUrl: record.sourceUrl,
  });
  const claimsJson = { promotion: record };
  const plan = buildPromotionPlan({
    sourceKey: record.sourceKey,
    externalId,
    sourceUrl: record.sourceUrl,
    canonicalKey,
    claimsJson,
  });
  return { record, externalId, canonicalKey, stableKey, claimsJson, plan };
}

function bestOfficialUrlFromCandidate(
  raw: Record<string, unknown>,
  normalized: Record<string, unknown>,
  sourceUrl: string | null,
): string | null {
  const urls = [
    stringValue(raw.officialWebsite),
    stringValue(raw.officialUrl),
    stringValue(raw.url),
    ...duplicateBindingOfficialUrls(raw.duplicateBindings),
    stringValue(normalized.officialUrl),
    ...(sourceUrl && isLikelyOfficialPage(sourceUrl) ? [sourceUrl] : []),
  ].filter((url): url is string => typeof url === 'string' && isLikelyOfficialPage(url));

  const deduped = [...new Set(urls)];
  if (deduped.length === 0) return null;
  return deduped.sort((a, b) => officialUrlScore(b) - officialUrlScore(a))[0] ?? null;
}

function duplicateBindingOfficialUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) return undefined;
      return stringValue((item as Record<string, unknown>).officialWebsite);
    })
    .filter((url): url is string => Boolean(url));
}

function officialUrlScore(url: string): number {
  try {
    const parsed = new URL(url);
    let score = 0;
    if (parsed.hostname.startsWith('www.')) score += 1;
    if (!/[/?&](?:[a-z]{2}(?:-[a-z]{2})?|[a-z]{2,5})[/?&-]/i.test(parsed.pathname)) score += 1;
    if (!parsed.search) score += 1;
    return score;
  } catch {
    return 0;
  }
}

// Known aggregator, review, and social-platform hostnames that are NOT
// official OEM product pages. This list supplements the protocol check so
// that Wikidata/MobileAPI sourced `officialWebsite` values that point to
// third-party sites don't result in unintended fetches.
const NON_OFFICIAL_HOST_PATTERNS =
  /gsmarena\.com|gsm\.com|phonearena\.com|kimovil\.com|notebookcheck|\bgsm\b|reddit\.com|youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|facebook\.com|tiktok\.com|amazon\.com|bestbuy\.com|walmart\.com|ebay\.com|flipkart\.com|wikidata\.org|wikipedia\.org|api\.mobileapi\.dev|commons\.wikimedia\.org/i;

function isLikelyOfficialPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !NON_OFFICIAL_HOST_PATTERNS.test(parsed.hostname);
  } catch {
    return false;
  }
}

function fallbackExternalId(record: CatalogImportRecord): string {
  return (
    record.slug ??
    buildCanonicalKey({
      brand: record.brand,
      model: record.model,
      launchDate: record.launchDate,
    })
  );
}

function formatIssueSummary(issues: readonly { fieldPath?: string; message: string }[]): string {
  const fields = [
    ...new Set(
      issues
        .map((issue) => issue.fieldPath)
        .filter((fieldPath): fieldPath is string => Boolean(fieldPath)),
    ),
  ];
  if (fields.length === 0) return '';
  const shown = fields.slice(0, 8).join(',');
  const suffix = fields.length > 8 ? `,+${fields.length - 8}` : '';
  return `missing=[${shown}${suffix}]`;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:enrich-oem [options]',
      '',
      'Options:',
      '  --url <url>           Fetch one official OEM product page',
      '  --from-candidates     Enrich staged candidates that contain official URLs',
      '  --limit N             Max URLs to fetch (default: 25)',
      '  --dry-run             Fetch and validate without DB writes',
      '  --promote             Promote valid extracted candidates',
      '  --update-existing     Refresh existing matched phones during promotion',
      '  --min-request-gap-ms N Delay between OEM page fetches (default: 2000)',
      '  --help                Print this message',
    ].join('\n'),
  );
}

function exitWithUsage(message: string): never {
  console.error(`[catalog:enrich-oem] ${message}\n`);
  printUsage();
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error('[catalog:enrich-oem] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

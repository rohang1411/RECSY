#!/usr/bin/env tsx
/**
 * Prune, reconcile, and unlock catalog refresh candidates.
 *
 * This is an automated hygiene and reconciliation engine:
 * 1. Universally reconciles duplicate/unlinked candidates to active phones.
 * 2. Archives non-phone pages (shop/commerce URLs, accessories, categories, flip feature phones).
 * 3. Archives speculative rumors and unreleased candidates.
 * 4. Archives long-tail/niche ODM devices that cannot be enriched without valid specs.
 * 5. Excludes archived candidates from active queues and dashboard blocked/pending counts.
 *
 * Usage:
 *   pnpm catalog:prune --dry-run
 *   pnpm catalog:prune
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import {
  DEFAULT_MAINSTREAM_BRAND_PRIORITY,
  isLikelyCatalogPhoneTitle,
  isReleasedCatalogCandidate,
  isWeakCatalogReleaseDate,
  normalizeIdentityText,
} from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns, phones } from '../src/services/db/schema';
import {
  catalogExactModelKey,
  isMainstreamCatalogCandidate,
} from '../src/services/catalog/candidate-policy';
import { PhoneSpecSchema } from '../src/features/phones/schema';
import { activeCatalogCandidateSql } from '../src/services/catalog/eligibility';

interface CliArgs {
  readonly dryRun: boolean;
  readonly deleteOldSkipped: boolean;
  readonly olderThanDays: number;
  readonly limit: number;
}

interface CandidateRow {
  readonly id: string;
  readonly title: string;
  readonly canonicalKey: string | null;
  readonly status: string;
  readonly decision: string | null;
  readonly matchedPhoneId: string | null;
  readonly issueCodes: readonly string[];
  readonly raw: Record<string, unknown>;
  readonly normalized: Record<string, unknown>;
  readonly retryAfter: Date | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let dryRun = false;
  let deleteOldSkipped = false;
  let olderThanDays = 180;
  let limit = 1_000;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--delete':
        deleteOldSkipped = true;
        break;
      case '--older-than-days':
        olderThanDays = parsePositiveInt(argv[++i], '--older-than-days');
        break;
      case '--limit':
        limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  return { dryRun, deleteOldSkipped, olderThanDays, limit };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'catalog_runs' },
    { table: 'catalog_candidates' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:prune', missing));
    process.exit(0);
  }

  const startedAt = Date.now();
  const rows = await db
    .select({
      id: catalogCandidates.id,
      title: catalogCandidates.candidateTitle,
      canonicalKey: catalogCandidates.canonicalKey,
      status: catalogCandidates.status,
      decision: catalogCandidates.decision,
      matchedPhoneId: catalogCandidates.matchedPhoneId,
      issueCodes: catalogCandidates.issueCodes,
      raw: catalogCandidates.rawCandidateJson,
      normalized: catalogCandidates.normalizedIdentityJson,
      retryAfter: catalogCandidates.retryAfter,
    })
    .from(catalogCandidates)
    .where(
      inArray(catalogCandidates.status, [
        'discovered',
        'quarantined',
        'failed',
        'failed_transient',
        'skipped',
        'validated',
      ]),
    )
    .limit(args.limit);

  // 1. Fetch active phones to universally reconcile existing models
  const existingPhones = await db
    .select({
      id: phones.id,
      slug: phones.slug,
      brand: phones.brand,
      model: phones.model,
      canonicalKey: phones.canonicalKey,
      spec: phones.specJson,
    })
    .from(phones)
    .where(eq(phones.status, 'active'));

  const existingPhoneIds = new Set(existingPhones.map((p) => p.id));
  const phonesByExactModel = new Map<string, string>();
  const phonesByCanonicalKey = new Map<string, string>();
  const phonesBySlug = new Map<string, string>();
  const phonesByNormalizedFullName = new Map<string, string>();

  for (const p of existingPhones) {
    if (!PhoneSpecSchema.safeParse(p.spec).success) continue;
    const exactKey = catalogExactModelKey(p.brand, p.model);
    phonesByExactModel.set(exactKey, p.id);
    if (p.canonicalKey) phonesByCanonicalKey.set(p.canonicalKey, p.id);
    if (p.slug) phonesBySlug.set(p.slug, p.id);
    phonesByNormalizedFullName.set(normalizeIdentityText(`${p.brand} ${p.model}`), p.id);
    phonesByNormalizedFullName.set(normalizeIdentityText(p.model), p.id);
  }

  function findExistingPhoneMatch(row: CandidateRow): string | null {
    if (row.matchedPhoneId && existingPhoneIds.has(row.matchedPhoneId)) {
      return row.matchedPhoneId;
    }
    if (row.canonicalKey && phonesByCanonicalKey.has(row.canonicalKey)) {
      return phonesByCanonicalKey.get(row.canonicalKey)!;
    }
    const brand = candidateBrand(row);
    const model = stringValue(row.normalized.model) ?? stringValue(row.raw.model) ?? row.title;
    if (brand && model) {
      const exactKey = catalogExactModelKey(brand, model);
      if (phonesByExactModel.has(exactKey)) {
        return phonesByExactModel.get(exactKey)!;
      }
    }
    const normalizedTitle = normalizeIdentityText(row.title);
    if (phonesByNormalizedFullName.has(normalizedTitle)) {
      return phonesByNormalizedFullName.get(normalizedTitle)!;
    }
    if (model) {
      const normalizedModel = normalizeIdentityText(model);
      if (phonesByNormalizedFullName.has(normalizedModel)) {
        return phonesByNormalizedFullName.get(normalizedModel)!;
      }
    }
    return null;
  }

  // Identify candidates matching active phones in the database
  const matchedExisting: { candidateId: string; phoneId: string }[] = [];
  const matchedCandidateIds = new Set<string>();

  for (const row of rows) {
    const matchedPhoneId = findExistingPhoneMatch(row);
    if (matchedPhoneId) {
      // If candidate is not already marked as promoted with this phoneId
      if (row.status !== 'promoted' || row.matchedPhoneId !== matchedPhoneId) {
        matchedExisting.push({ candidateId: row.id, phoneId: matchedPhoneId });
        matchedCandidateIds.add(row.id);
      }
    }
  }

  // 2. Classify candidates that do not match active phones
  const actions = rows
    .filter((row) => !matchedCandidateIds.has(row.id))
    .map(classifyCandidate)
    .filter((action): action is PruneAction => Boolean(action));

  const nonPhoneIds = actions
    .filter((action) => action.kind === 'skip_non_phone')
    .map((action) => action.id);
  const unreleasedIds = actions
    .filter((action) => action.kind === 'skip_unreleased')
    .map((action) => action.id);
  const longTailIds = actions
    .filter((action) => action.kind === 'skip_long_tail')
    .map((action) => action.id);
  const unlockIds = actions
    .filter((action) => action.kind === 'unlock_priority')
    .map((action) => action.id);

  const cutoff = new Date(Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000);
  const deleteIds =
    args.deleteOldSkipped && !args.dryRun
      ? (
          await db
            .select({ id: catalogCandidates.id })
            .from(catalogCandidates)
            .where(
              and(
                activeCatalogCandidateSql(),
                eq(catalogCandidates.status, 'skipped'),
                lt(catalogCandidates.updatedAt, cutoff),
              ),
            )
            .limit(args.limit)
        ).map((row) => row.id)
      : [];

  if (!args.dryRun) {
    for (const match of matchedExisting) {
      await db
        .update(catalogCandidates)
        .set({
          matchedPhoneId: match.phoneId,
          status: 'promoted',
          decision: 'matched_existing',
          issueCodes: ['matched_existing'],
          retryAfter: null,
          lastDecisionAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(catalogCandidates.id, match.candidateId));
    }

    if (nonPhoneIds.length > 0) {
      await db
        .update(catalogCandidates)
        .set({
          decision: 'skip',
          status: 'skipped',
          issueCodes: ['non_phone_device', 'archived_candidate'],
          retryAfter: null,
          lastDecisionAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(catalogCandidates.id, nonPhoneIds));
    }

    if (longTailIds.length > 0) {
      await db
        .update(catalogCandidates)
        .set({
          decision: 'skip',
          status: 'skipped',
          issueCodes: ['long_tail_pruned', 'archived_candidate'],
          retryAfter: sql`now() + interval '180 days'`,
          lastDecisionAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(catalogCandidates.id, longTailIds));
    }

    if (unreleasedIds.length > 0) {
      await db
        .update(catalogCandidates)
        .set({
          decision: 'skip',
          status: 'skipped',
          issueCodes: ['speculative_candidate', 'archived_candidate'],
          retryAfter: sql`now() + interval '30 days'`,
          lastDecisionAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(catalogCandidates.id, unreleasedIds));
    }

    if (unlockIds.length > 0) {
      await db
        .update(catalogCandidates)
        .set({
          decision: 'pending_review',
          status: 'discovered',
          issueCodes: sql`array_remove(array_remove(array_remove(array_remove(${catalogCandidates.issueCodes}, 'long_tail_pruned'), 'llm_budget_exhausted'), 'unreleased_candidate'), 'speculative_candidate')`,
          retryAfter: null,
          lastDecisionAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(inArray(catalogCandidates.id, unlockIds));
    }

    if (deleteIds.length > 0) {
      await db.delete(catalogCandidates).where(inArray(catalogCandidates.id, deleteIds));
    }

    await db.insert(catalogRuns).values({
      kind: 'scheduled',
      status: 'success',
      stage: 'prune',
      checkpointJson: {
        deleteOldSkipped: args.deleteOldSkipped,
        olderThanDays: args.olderThanDays,
        limit: args.limit,
      },
      skippedCount: nonPhoneIds.length + longTailIds.length + unreleasedIds.length,
      updatedCount: unlockIds.length + matchedExisting.length,
      requestCount: 0,
      llmCallCount: 0,
      finishedAt: sql`now()`,
      durationMs: Date.now() - startedAt,
    });
  }

  const prefix = args.dryRun ? '[catalog:prune] dry-run' : '[catalog:prune] done';
  console.log(
    `${prefix} scanned=${rows.length} matched_existing=${matchedExisting.length} non_phone=${nonPhoneIds.length} unreleased=${unreleasedIds.length} long_tail=${longTailIds.length} unlocked=${unlockIds.length} deleted=${deleteIds.length} llm_calls=0`,
  );
}

type PruneAction =
  | { readonly kind: 'skip_non_phone'; readonly id: string }
  | { readonly kind: 'skip_unreleased'; readonly id: string }
  | { readonly kind: 'skip_long_tail'; readonly id: string }
  | { readonly kind: 'unlock_priority'; readonly id: string };

function classifyCandidate(row: CandidateRow): PruneAction | null {
  if (
    row.issueCodes.includes('archived_candidate') ||
    row.issueCodes.includes('non_phone_device')
  ) {
    return null;
  }
  const brand = candidateBrand(row);
  const model = stringValue(row.normalized.model) ?? stringValue(row.raw.model) ?? row.title;
  const rawDeviceType = normalizeIdentityText(
    stringValue(row.raw.device_type) ?? stringValue(row.raw.deviceType) ?? '',
  );

  const isRawNonPhone =
    rawDeviceType.length > 0 && !['phone', 'smartphone', 'mobile'].includes(rawDeviceType);
  const isTitleNonPhone =
    !isLikelyCatalogPhoneTitle(row.title) || !isLikelyCatalogPhoneTitle(model);
  if (isRawNonPhone || isTitleNonPhone) return { kind: 'skip_non_phone', id: row.id };
  if (row.matchedPhoneId || row.status === 'promoted' || row.status === 'ready_to_promote') {
    return null;
  }

  const released = isReleasedCatalogCandidate({
    brand,
    model,
    title: row.title,
    launchDate: stringValue(row.normalized.launchDate) ?? stringValue(row.raw.launchDate),
    releaseDate: stringValue(row.normalized.releaseDate) ?? stringValue(row.raw.releaseDate),
    releasedAt: stringValue(row.raw.releasedAt),
  });

  const isSpeculative =
    row.issueCodes.includes('speculative_candidate') ||
    row.issueCodes.includes('unreleased_candidate') ||
    isWeakCatalogReleaseDate(stringValue(row.normalized.launchDate)) ||
    isWeakCatalogReleaseDate(stringValue(row.raw.releaseDate));

  if (!released || isSpeculative) {
    return { kind: 'skip_unreleased', id: row.id };
  }

  // Non-mainstream brands or devices that failed enrichment without specs
  const isPriority = isMainstreamCatalogCandidate({ brand, model, title: row.title });
  if (!isPriority) {
    return { kind: 'skip_long_tail', id: row.id };
  }

  // For mainstream brands, if it failed enrichment or hit LLM budget with no valid spec
  if (
    row.status === 'quarantined' ||
    row.status === 'failed' ||
    row.status === 'failed_transient' ||
    row.decision === 'quarantine' ||
    row.issueCodes.includes('llm_budget_exhausted') ||
    row.issueCodes.includes('implausible_value') ||
    (row.decision === 'pending_review' && row.issueCodes.includes('llm_budget_exhausted'))
  ) {
    return { kind: 'skip_unreleased', id: row.id };
  }

  if (
    row.status === 'skipped' &&
    (row.issueCodes.includes('long_tail_pruned') || row.issueCodes.includes('unreleased_candidate'))
  ) {
    return { kind: 'unlock_priority', id: row.id };
  }
  return null;
}

function candidateBrand(row: CandidateRow): string | null {
  return (
    stringValue(row.normalized.brand) ??
    stringValue(row.raw.brand) ??
    stringValue(row.raw.manufacturer) ??
    inferPriorityBrand([row.title, stringValue(row.normalized.model), stringValue(row.raw.model)])
  );
}

function inferPriorityBrand(values: readonly (string | undefined)[]): string | null {
  const haystack = normalizeIdentityText(values.filter(Boolean).join(' '));
  if (!haystack) return null;
  for (const entry of DEFAULT_MAINSTREAM_BRAND_PRIORITY) {
    for (const brand of entry.brands) {
      const normalizedBrand = normalizeIdentityText(brand);
      if (normalizedBrand && new RegExp(`\\b${escapeRegExp(normalizedBrand)}\\b`).test(haystack)) {
        return entry.company;
      }
    }
  }
  if (/\biphone\b/.test(haystack)) return 'Apple';
  if (/\bpixel\b/.test(haystack)) return 'Google';
  return null;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${flag}`);
  return parsed;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:prune [options]',
      '',
      'Options:',
      '  --dry-run              Print counts without changing candidates',
      '  --delete               Hard-delete old skipped candidates only',
      '  --older-than-days N    Age threshold for --delete (default: 180)',
      '  --limit N              Max candidates to scan (default: 1000)',
      '  --help                 Print this message',
    ].join('\n'),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[catalog:prune] FAILED');
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  });

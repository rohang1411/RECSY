#!/usr/bin/env tsx
/**
 * Prune and unlock catalog refresh candidates.
 *
 * This is a queue hygiene step, not a destructive cleanup by default. It
 * removes non-phones and long-tail quarantines from the active enrichment queue
 * while making priority-brand candidates retryable.
 *
 * Usage:
 *   pnpm catalog:prune --dry-run
 *   pnpm catalog:prune
 */
import { and, eq, inArray, lt, sql } from 'drizzle-orm';

import {
  DEFAULT_MAINSTREAM_BRAND_PRIORITY,
  isLikelyCatalogPhoneTitle,
  isMainstreamPriorityBrand,
  isReleasedCatalogCandidate,
  normalizeIdentityText,
} from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';

interface CliArgs {
  readonly dryRun: boolean;
  readonly deleteOldSkipped: boolean;
  readonly olderThanDays: number;
  readonly limit: number;
}

interface CandidateRow {
  readonly id: string;
  readonly title: string;
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
      ]),
    )
    .limit(args.limit);

  const actions = rows
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
              and(eq(catalogCandidates.status, 'skipped'), lt(catalogCandidates.updatedAt, cutoff)),
            )
            .limit(args.limit)
        ).map((row) => row.id)
      : [];

  if (!args.dryRun) {
    if (nonPhoneIds.length > 0) {
      await db
        .update(catalogCandidates)
        .set({
          decision: 'skip',
          status: 'skipped',
          issueCodes: ['non_phone_device'],
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
          issueCodes: ['long_tail_pruned'],
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
          issueCodes: ['unreleased_candidate'],
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
          issueCodes: sql`array_remove(array_remove(${catalogCandidates.issueCodes}, 'long_tail_pruned'), 'llm_budget_exhausted')`,
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
      updatedCount: unlockIds.length,
      requestCount: 0,
      llmCallCount: 0,
      finishedAt: sql`now()`,
      durationMs: Date.now() - startedAt,
    });
  }

  const prefix = args.dryRun ? '[catalog:prune] dry-run' : '[catalog:prune] done';
  console.log(
    `${prefix} scanned=${rows.length} non_phone=${nonPhoneIds.length} unreleased=${unreleasedIds.length} long_tail=${longTailIds.length} unlocked=${unlockIds.length} deleted=${deleteIds.length} llm_calls=0`,
  );
}

type PruneAction =
  | { readonly kind: 'skip_non_phone'; readonly id: string }
  | { readonly kind: 'skip_unreleased'; readonly id: string }
  | { readonly kind: 'skip_long_tail'; readonly id: string }
  | { readonly kind: 'unlock_priority'; readonly id: string };

function classifyCandidate(row: CandidateRow): PruneAction | null {
  if (row.matchedPhoneId || row.status === 'promoted' || row.status === 'ready_to_promote') {
    return null;
  }

  const brand = candidateBrand(row);
  const model = stringValue(row.normalized.model) ?? stringValue(row.raw.model) ?? row.title;
  const title = [row.title, brand, model].filter(Boolean).join(' ');
  const rawDeviceType = normalizeIdentityText(
    stringValue(row.raw.device_type) ?? stringValue(row.raw.deviceType) ?? '',
  );

  const isRawNonPhone =
    rawDeviceType.length > 0 && !['phone', 'smartphone', 'mobile'].includes(rawDeviceType);
  const isTitleNonPhone = !isLikelyCatalogPhoneTitle(title);
  if (isRawNonPhone || isTitleNonPhone) return { kind: 'skip_non_phone', id: row.id };

  const released = isReleasedCatalogCandidate({
    brand,
    model,
    title: row.title,
    launchDate: stringValue(row.normalized.launchDate) ?? stringValue(row.raw.launchDate),
    releaseDate: stringValue(row.normalized.releaseDate) ?? stringValue(row.raw.releaseDate),
    releasedAt: stringValue(row.raw.releasedAt),
  });
  if (!released) return { kind: 'skip_unreleased', id: row.id };

  if (isMainstreamPriorityBrand(brand)) {
    if (row.status === 'skipped' && row.issueCodes.includes('non_phone_device')) return null;
    if (
      row.status !== 'discovered' ||
      row.decision !== 'pending_review' ||
      row.retryAfter !== null ||
      row.issueCodes.includes('long_tail_pruned') ||
      row.issueCodes.includes('llm_budget_exhausted')
    ) {
      return { kind: 'unlock_priority', id: row.id };
    }
    return null;
  }

  if (
    row.status === 'quarantined' ||
    row.status === 'failed' ||
    row.status === 'failed_transient'
  ) {
    return { kind: 'skip_long_tail', id: row.id };
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

main().catch((err) => {
  console.error('[catalog:prune] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

#!/usr/bin/env tsx
/**
 * Catalog spec enrichment script.
 *
 * For each `pending_review` / `quarantine` candidate in the DB, this script
 * attempts to fetch structured specs from two free sources in priority order:
 *
 *   1. Wikipedia API (primary) - policy-compliant, no auth required, structured
 *      {{Infobox mobile phone}} wikitext converted to PhoneSpec via LLM.
 *   2. GSMArena (warm standby) - currently blocked by Cloudflare Turnstile, but
 *      kept in place so it activates automatically if access resumes.
 *
 * Both tiers share the same promotion/quarantine logic. Candidates are processed
 * in brand-priority order (Apple > Samsung > Nothing > OnePlus > vivo > Xiaomi)
 * so high-value phones are enriched first.
 *
 * Usage:
 *   pnpm catalog:enrich-gsmarena
 *   npm run catalog:enrich-gsmarena
 */
import { and, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '../src/services/db/client';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';
import {
  fetchGsmarenaSpecs,
  isGsmarenaCatalogAvailable,
} from '../src/services/catalog/adapters/gsmarena';
import {
  fetchWikipediaSpecs,
  checkWikipediaAvailability,
} from '../src/services/catalog/adapters/wikipedia';
import {
  brandPriorityRank,
  buildCanonicalKey,
  buildPromotionPlan,
  catalogReleaseRetryAfter,
  catalogReleaseTimestamp,
  hashJson,
  isFutureCatalogDate,
  isLikelyCatalogPhoneTitle,
  isMainstreamPriorityBrand,
  normalizeIdentityText,
  phoneSpecToCatalogProjectionInput,
  promoteCatalogCandidate,
} from '../src/services/catalog';

const LOG = '[catalog:enrich]';

type CatalogCandidateRow = typeof catalogCandidates.$inferSelect;

interface CliArgs {
  readonly limit: number;
  readonly retryAll: boolean;
  readonly maxLlmCalls: number;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let limit = 25;
  let retryAll = false;
  let maxLlmCalls = 5;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--limit':
        limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--retry-all':
        retryAll = true;
        break;
      case '--max-llm-calls':
        maxLlmCalls = parseNonNegativeInt(argv[++i], '--max-llm-calls');
        break;
      case '--help':
      case '-h':
        console.log(
          'Usage: pnpm catalog:enrich-gsmarena [--limit 25] [--max-llm-calls 5] [--retry-all]',
        );
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return { limit, retryAll, maxLlmCalls };
}

interface ResolvedCatalogCandidate {
  readonly row: CatalogCandidateRow;
  readonly brand: string;
  readonly model: string;
}

function resolveBrandModel(c: CatalogCandidateRow): ResolvedCatalogCandidate | null {
  const id = c.normalizedIdentityJson;
  const brand = recordString(id, 'brand') ?? inferBrandFromTitle(c.candidateTitle);
  const model = recordString(id, 'model') ?? c.candidateTitle;
  if (!brand || !model) return null;
  return { row: c, brand, model };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = getDb();

  // Check source availability upfront so disabled fallbacks don't spam logs.
  const [wikiAvailable, gsmarenaAvailable] = await Promise.all([
    checkWikipediaAvailability(),
    isGsmarenaCatalogAvailable(),
  ]);
  console.log(`${LOG} Wikipedia API available: ${wikiAvailable}`);
  console.log(`${LOG} GSMArena fallback available: ${gsmarenaAvailable}`);

  const candidates = await db
    .select()
    .from(catalogCandidates)
    .where(
      or(
        inArray(catalogCandidates.decision, ['pending_review', 'quarantine']),
        and(
          eq(catalogCandidates.status, 'promoted'),
          sql`'low_completeness' = any(${catalogCandidates.issueCodes})`,
          args.retryAll
            ? undefined
            : or(
                isNull(catalogCandidates.retryAfter),
                lte(catalogCandidates.retryAfter, new Date()),
              ),
        ),
      ),
    );

  const candidateRows = candidates
    .map(resolveBrandModel)
    .filter((candidate): candidate is ResolvedCatalogCandidate => candidate != null);
  const unreleasedCandidates = candidateRows.filter((candidate) =>
    isUnreleasedCandidate(candidate.row),
  );
  for (const candidate of unreleasedCandidates) {
    await markDeferredUnreleased(db, candidate.row);
  }

  const releasedRows = candidateRows.filter((candidate) => !isUnreleasedCandidate(candidate.row));
  const skippedNonPhones = releasedRows.filter((candidate) => !isLikelyPhoneCandidate(candidate));
  for (const candidate of skippedNonPhones) {
    await markSkippedNonPhone(db, candidate.row);
  }

  const retryEligibleRows = releasedRows.filter((candidate) => isRetryEligible(candidate, args));

  // Filter out candidates without brand/model and obvious non-phone devices,
  // then sort by the shared catalog priority: mainstream brand first, newest
  // release next, then unresolved pending rows before older quarantines.
  const pending = retryEligibleRows
    .filter(isLikelyPhoneCandidate)
    .filter(isPriorityOrFreshCandidate)
    .sort((a, b) => {
      const rankA = brandPriorityRank(a.brand);
      const rankB = brandPriorityRank(b.brand);
      if (rankA !== rankB) return rankA - rankB;

      const dateA = candidateReleaseTime(a.row);
      const dateB = candidateReleaseTime(b.row);
      if (dateA !== dateB) return dateB - dateA;

      const stateA = candidateStatePriority(a.row);
      const stateB = candidateStatePriority(b.row);
      if (stateA !== stateB) return stateA - stateB;

      return a.row.candidateTitle.localeCompare(b.row.candidateTitle);
    })
    .slice(0, args.limit);

  if (pending.length === 0) {
    console.log(
      `${LOG} No pending candidates to enrich. Skipped=${skippedNonPhones.length}, Deferred=${unreleasedCandidates.length}`,
    );
    return;
  }

  console.log(
    `${LOG} Processing ${pending.length} candidates in brand-priority + newest-first order.`,
  );

  const [run] = await db
    .insert(catalogRuns)
    .values({
      kind: 'manual',
      status: 'running',
      stage: 'import_promote',
      maxLlmCalls: args.maxLlmCalls,
      checkpointJson: {
        script: 'catalog-enrich',
        sources: ['wikipedia', 'gsmarena'],
        wikiAvailable,
        gsmarenaAvailable,
        deferredUnreleased: unreleasedCandidates.length,
      },
    })
    .returning({ id: catalogRuns.id });

  let updated = 0;
  let promoted = 0;
  let quarantined = 0;
  let needsEnrichment = 0;
  const skipped = skippedNonPhones.length;
  const deferred = unreleasedCandidates.length;
  let llmCalls = 0;
  let wikiHits = 0;
  let gsmarenaHits = 0;

  for (const candidate of pending) {
    const brand = candidate.brand;
    const model = candidate.model;
    if (llmCalls >= args.maxLlmCalls) {
      console.log(`  -> LLM budget exhausted; leaving remaining candidates pending.`);
      await markLlmBudgetExhausted(db, candidate.row);
      continue;
    }
    console.log(`${LOG} [${brand} ${model}] Fetching specs...`);

    let spec = null;
    let sourceKey = 'unknown';

    // -----------------------------------------------------------------------
    // Tier 1: Wikipedia API
    // -----------------------------------------------------------------------
    if (wikiAvailable) {
      spec = await fetchWikipediaSpecs(brand, model);
      if (spec) {
        wikiHits++;
        sourceKey = 'wikipedia_infobox';
        llmCalls++;
        if (run) {
          await db
            .update(catalogRuns)
            .set({ llmCallCount: llmCalls })
            .where(eq(catalogRuns.id, run.id));
        }
        console.log(`  -> Found on Wikipedia`);
      } else if (gsmarenaAvailable) {
        console.log(`  -> Not found on Wikipedia; trying GSMArena fallback...`);
      } else {
        console.log(`  -> Not found on Wikipedia; GSMArena fallback unavailable.`);
      }
    }

    // -----------------------------------------------------------------------
    // Tier 2: GSMArena (warm standby - may be blocked by Cloudflare Turnstile)
    // -----------------------------------------------------------------------
    if (!spec && gsmarenaAvailable) {
      spec = await fetchGsmarenaSpecs(brand, model);
      if (spec) {
        gsmarenaHits++;
        sourceKey = 'gsmarena_specs';
        llmCalls++;
        if (run) {
          await db
            .update(catalogRuns)
            .set({ llmCallCount: llmCalls })
            .where(eq(catalogRuns.id, run.id));
        }
        console.log(`  -> Found on GSMArena`);
      } else {
        console.log(`  -> Not found on either source - quarantining.`);
        quarantined++;
        await markNoSpecSourceFound(db, candidate.row);
        continue;
      }
    }

    if (!spec) {
      console.log(`  -> Not found on available sources; quarantining.`);
      quarantined++;
      await markNoSpecSourceFound(db, candidate.row);
      continue;
    }

    // -----------------------------------------------------------------------
    // Promote the candidate using whatever spec we obtained
    // -----------------------------------------------------------------------
    const record = {
      sourceKey,
      sourceType: 'article' as const,
      sourceTier: 'T2' as const,
      brand,
      model,
      launchDate: candidateReleaseValue(candidate.row),
      spec: phoneSpecToCatalogProjectionInput(spec),
    };

    const canonicalKey = buildCanonicalKey({ brand, model, launchDate: record.launchDate });
    const claimsJson = { promotion: record };

    const plan = buildPromotionPlan({
      sourceKey,
      externalId: candidate.row.externalId ?? candidate.row.stableKey,
      sourceUrl: candidate.row.sourceUrl ?? undefined,
      canonicalKey,
      claimsJson,
    });
    const coreIncomplete = isCoreIncompletePlan(plan.issues);

    await db
      .update(catalogCandidates)
      .set({
        claimsJson,
        contentHash: hashJson(claimsJson),
        decision: plan.ok ? 'promote' : coreIncomplete ? 'pending_review' : 'quarantine',
        status: plan.ok ? 'ready_to_promote' : coreIncomplete ? 'discovered' : 'quarantined',
        issueCodes: plan.ok
          ? []
          : [
              ...new Set([
                ...plan.issues.map((i) => i.code),
                ...(coreIncomplete ? ['needs_enrichment', 'core_spec_incomplete'] : []),
              ]),
            ],
        retryAfter: plan.ok ? null : catalogReleaseRetryAfter(null),
        lastDecisionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(catalogCandidates.id, candidate.row.id));

    updated++;

    if (plan.ok) {
      const result = await promoteCatalogCandidate(db, candidate.row.id, { updateExisting: true });
      if (result.action === 'created' || result.action === 'updated') {
        promoted++;
        console.log(`  -> Promoted to catalog (action=${result.action})`);
      }
    } else {
      if (coreIncomplete) {
        needsEnrichment++;
        console.log(
          `  -> Source found but core spec is incomplete: ${plan.issues.map((i) => i.code).join(', ')}`,
        );
        continue;
      }
      quarantined++;
      console.log(`  -> Blocked by validation: ${plan.issues.map((i) => i.code).join(', ')}`);
    }
  }

  if (run) {
    await db
      .update(catalogRuns)
      .set({
        status: 'success',
        stage: 'done',
        updatedCount: updated,
        skippedCount: skipped,
        quarantinedCount: quarantined,
        llmCallCount: llmCalls,
        finishedAt: sql`now()`,
      })
      .where(eq(catalogRuns.id, run.id));
  }

  console.log(
    `${LOG} Done. Updated=${updated}, Promoted=${promoted}, Quarantined=${quarantined}, ` +
      `NeedsEnrichment=${needsEnrichment}, Skipped=${skipped}, Deferred=${deferred}, LLM Calls=${llmCalls}, Wikipedia Hits=${wikiHits}, GSMArena Hits=${gsmarenaHits}`,
  );
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag}`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${flag}`);
  }
  return parsed;
}

function isLikelyPhoneCandidate(candidate: ResolvedCatalogCandidate): boolean {
  const text = `${candidate.row.candidateTitle} ${candidate.model}`.toLowerCase();
  return isLikelyCatalogPhoneTitle(text);
}

function candidateReleaseTime(candidate: CatalogCandidateRow): number {
  return catalogReleaseTimestamp(candidateReleaseValue(candidate));
}

function candidateReleaseValue(candidate: CatalogCandidateRow): string | undefined {
  const normalized = candidate.normalizedIdentityJson;
  const raw = candidate.rawCandidateJson;
  return (
    recordString(normalized, 'launchDate') ??
    recordString(normalized, 'releaseDate') ??
    recordString(raw, 'launchDate') ??
    recordString(raw, 'releaseDate') ??
    recordString(raw, 'releasedAt')
  );
}

function isUnreleasedCandidate(candidate: CatalogCandidateRow): boolean {
  return isFutureCatalogDate(candidateReleaseValue(candidate));
}

function candidateStatePriority(candidate: CatalogCandidateRow): number {
  if (candidate.decision === 'pending_review') return 0;
  if (candidate.status === 'discovered') return 1;
  if (candidate.status === 'quarantined') return 2;
  return 3;
}

function isPriorityOrFreshCandidate(candidate: ResolvedCatalogCandidate): boolean {
  if (isMainstreamPriorityBrand(candidate.brand)) return true;
  if (
    candidate.row.status === 'promoted' &&
    candidate.row.issueCodes.includes('low_completeness')
  ) {
    return true;
  }
  // Long-tail rows get one enrichment attempt while freshly discovered. If
  // they quarantine, leave them for explicit retry windows so they cannot
  // crowd out Apple/Samsung/Pixel/Nothing/etc. on every scheduled run.
  return (
    candidate.row.decision === 'pending_review' &&
    (candidate.row.status === 'discovered' || candidate.row.status === 'failed_transient')
  );
}

function isRetryEligible(candidate: ResolvedCatalogCandidate, args: CliArgs): boolean {
  if (args.retryAll) return true;
  if (isMainstreamPriorityBrand(candidate.brand) && !isUnreleasedCandidate(candidate.row))
    return true;
  if (!candidate.row.retryAfter) return true;
  if (candidate.row.retryAfter <= new Date()) return true;
  if (
    candidate.row.decision === 'pending_review' &&
    candidate.row.status === 'discovered' &&
    candidate.row.issueCodes.includes('spec_projection_missing')
  ) {
    return true;
  }
  return false;
}

function isCoreIncompletePlan(issues: readonly { severity: string; code: string }[]): boolean {
  const blockers = issues.filter((issue) => issue.severity === 'blocker');
  return blockers.length > 0 && blockers.every((issue) => issue.code === 'missing_spec_field');
}

function inferBrandFromTitle(value: string): string | null {
  const normalized = normalizeIdentityText(value);
  for (const [needle, brand] of TITLE_BRAND_HINTS) {
    if (normalized === needle || normalized.startsWith(`${needle} `)) return brand;
  }
  return null;
}

function recordString(value: unknown, key: string): string | undefined {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = (value as Record<string, unknown>)[key];
  return typeof item === 'string' && item.trim() ? item.trim() : undefined;
}

async function markSkippedNonPhone(
  db: ReturnType<typeof getDb>,
  candidate: CatalogCandidateRow,
): Promise<void> {
  await db
    .update(catalogCandidates)
    .set({
      decision: 'skip',
      status: 'skipped',
      issueCodes: ['non_phone_device'],
      lastDecisionAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(catalogCandidates.id, candidate.id));
}

async function markDeferredUnreleased(
  db: ReturnType<typeof getDb>,
  candidate: CatalogCandidateRow,
): Promise<void> {
  const releaseValue = candidateReleaseValue(candidate);
  await db
    .update(catalogCandidates)
    .set({
      decision: 'pending_review',
      status: 'failed_transient',
      issueCodes: ['unreleased_candidate'],
      retryAfter: catalogReleaseRetryAfter(releaseValue),
      lastDecisionAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(catalogCandidates.id, candidate.id));
}

async function markLlmBudgetExhausted(
  db: ReturnType<typeof getDb>,
  candidate: CatalogCandidateRow,
): Promise<void> {
  await db
    .update(catalogCandidates)
    .set({
      decision: candidate.decision ?? 'pending_review',
      status: candidate.status === 'promoted' ? 'promoted' : 'failed_transient',
      issueCodes: [...new Set([...candidate.issueCodes, 'llm_budget_exhausted'])],
      retryAfter: new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastDecisionAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(catalogCandidates.id, candidate.id));
}

async function markNoSpecSourceFound(
  db: ReturnType<typeof getDb>,
  candidate: CatalogCandidateRow,
): Promise<void> {
  const retryAfter = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(catalogCandidates)
    .set({
      decision: 'quarantine',
      status: 'quarantined',
      issueCodes: ['spec_source_not_found'],
      retryAfter,
      lastDecisionAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(catalogCandidates.id, candidate.id));
}

const TITLE_BRAND_HINTS: readonly (readonly [string, string])[] = [
  ['iphone', 'Apple'],
  ['samsung', 'Samsung'],
  ['galaxy', 'Samsung'],
  ['google pixel', 'Google'],
  ['pixel', 'Google'],
  ['nothing phone', 'Nothing'],
  ['cmf phone', 'Nothing'],
  ['oneplus', 'OnePlus'],
  ['oppo', 'OPPO'],
  ['realme', 'Realme'],
  ['vivo', 'vivo'],
  ['iqoo', 'vivo'],
  ['xiaomi', 'Xiaomi'],
  ['redmi', 'Xiaomi'],
  ['poco', 'Xiaomi'],
  ['motorola', 'Motorola'],
  ['moto', 'Motorola'],
  ['honor', 'Honor'],
  ['sony xperia', 'Sony'],
  ['xperia', 'Sony'],
  ['huawei', 'Huawei'],
  ['tecno', 'Tecno'],
  ['infinix', 'Infinix'],
  ['itel', 'itel'],
];

main().catch((err) => {
  console.error(`${LOG} FAILED`);
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

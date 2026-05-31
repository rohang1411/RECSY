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
  phoneSpecToCatalogProjectionInput,
  promoteCatalogCandidate,
} from '../src/services/catalog';

const LOG = '[catalog:enrich]';

type CatalogCandidateRow = typeof catalogCandidates.$inferSelect;

interface CliArgs {
  readonly limit: number;
  readonly retryAll: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  let limit = 25;
  let retryAll = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--limit':
        limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--retry-all':
        retryAll = true;
        break;
      case '--help':
      case '-h':
        console.log('Usage: pnpm catalog:enrich-gsmarena [--limit 25] [--retry-all]');
        process.exit(0);
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }
  return { limit, retryAll };
}

function hasBrandAndModel(c: CatalogCandidateRow): c is CatalogCandidateRow & {
  normalizedIdentityJson: { brand: string; model: string };
} {
  const id = c.normalizedIdentityJson;
  return typeof id.brand === 'string' && typeof id.model === 'string';
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
      and(
        inArray(catalogCandidates.decision, ['pending_review', 'quarantine']),
        args.retryAll
          ? undefined
          : or(isNull(catalogCandidates.retryAfter), lte(catalogCandidates.retryAfter, new Date())),
      ),
    );

  const candidateRows = candidates.filter(hasBrandAndModel);
  const unreleasedCandidates = candidateRows.filter(isUnreleasedCandidate);
  for (const candidate of unreleasedCandidates) {
    await markDeferredUnreleased(db, candidate);
  }

  const releasedRows = candidateRows.filter((candidate) => !isUnreleasedCandidate(candidate));
  const skippedNonPhones = releasedRows.filter((candidate) => !isLikelyPhoneCandidate(candidate));
  for (const candidate of skippedNonPhones) {
    await markSkippedNonPhone(db, candidate);
  }

  // Filter out candidates without brand/model and obvious non-phone devices,
  // then sort by the shared catalog priority: mainstream brand first, newest
  // release next, then unresolved pending rows before older quarantines.
  const pending = releasedRows
    .filter(isLikelyPhoneCandidate)
    .filter(isPriorityOrFreshCandidate)
    .sort((a, b) => {
      const rankA = brandPriorityRank(a.normalizedIdentityJson.brand);
      const rankB = brandPriorityRank(b.normalizedIdentityJson.brand);
      if (rankA !== rankB) return rankA - rankB;

      const dateA = candidateReleaseTime(a);
      const dateB = candidateReleaseTime(b);
      if (dateA !== dateB) return dateB - dateA;

      const stateA = candidateStatePriority(a);
      const stateB = candidateStatePriority(b);
      if (stateA !== stateB) return stateA - stateB;

      return a.candidateTitle.localeCompare(b.candidateTitle);
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
      maxLlmCalls: pending.length,
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
  const skipped = skippedNonPhones.length;
  const deferred = unreleasedCandidates.length;
  let llmCalls = 0;
  let wikiHits = 0;
  let gsmarenaHits = 0;

  for (const candidate of pending) {
    const brand = String(candidate.normalizedIdentityJson.brand);
    const model = String(candidate.normalizedIdentityJson.model);
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
        console.log(`  -> Found on GSMArena`);
      } else {
        console.log(`  -> Not found on either source - quarantining.`);
        quarantined++;
        await markNoSpecSourceFound(db, candidate);
        continue;
      }
    }

    if (!spec) {
      console.log(`  -> Not found on available sources; quarantining.`);
      quarantined++;
      await markNoSpecSourceFound(db, candidate);
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
      spec: phoneSpecToCatalogProjectionInput(spec),
    };

    const canonicalKey = buildCanonicalKey({ brand, model });
    const claimsJson = { promotion: record };

    const plan = buildPromotionPlan({
      sourceKey,
      externalId: candidate.externalId ?? candidate.stableKey,
      sourceUrl: candidate.sourceUrl ?? undefined,
      canonicalKey,
      claimsJson,
    });

    await db
      .update(catalogCandidates)
      .set({
        claimsJson,
        contentHash: hashJson(claimsJson),
        decision: plan.ok ? 'promote' : 'quarantine',
        status: plan.ok ? 'ready_to_promote' : 'quarantined',
        issueCodes: plan.ok ? [] : [...new Set(plan.issues.map((i) => i.code))],
        lastDecisionAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(catalogCandidates.id, candidate.id));

    updated++;

    if (plan.ok) {
      const result = await promoteCatalogCandidate(db, candidate.id, { updateExisting: true });
      if (result.action === 'created' || result.action === 'updated') {
        promoted++;
        console.log(`  -> Promoted to catalog (action=${result.action})`);
      }
    } else {
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
      `Skipped=${skipped}, Deferred=${deferred}, LLM Calls=${llmCalls}, Wikipedia Hits=${wikiHits}, GSMArena Hits=${gsmarenaHits}`,
  );
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag}`);
  }
  return parsed;
}

function isLikelyPhoneCandidate(
  candidate: CatalogCandidateRow & {
    normalizedIdentityJson: { brand: string; model: string };
  },
): boolean {
  const text =
    `${candidate.candidateTitle} ${candidate.normalizedIdentityJson.model}`.toLowerCase();
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

function isPriorityOrFreshCandidate(
  candidate: CatalogCandidateRow & {
    normalizedIdentityJson: { brand: string; model: string };
  },
): boolean {
  if (isMainstreamPriorityBrand(candidate.normalizedIdentityJson.brand)) return true;
  // Long-tail rows get one enrichment attempt while freshly discovered. If
  // they quarantine, leave them for explicit retry windows so they cannot
  // crowd out Apple/Samsung/Pixel/Nothing/etc. on every scheduled run.
  return (
    candidate.decision === 'pending_review' &&
    (candidate.status === 'discovered' || candidate.status === 'failed_transient')
  );
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

main().catch((err) => {
  console.error(`${LOG} FAILED`);
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

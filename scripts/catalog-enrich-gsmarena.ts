#!/usr/bin/env tsx
/**
 * Catalog spec enrichment script.
 *
 * For each `pending_review` / `quarantine` candidate in the DB, this script
 * attempts to fetch structured specs from two free sources in priority order:
 *
 *   1. Wikipedia API (primary) — policy-compliant, no auth required, structured
 *      {{Infobox mobile phone}} wikitext converted to PhoneSpec via LLM.
 *   2. GSMArena (warm standby) — currently blocked by Cloudflare Turnstile, but
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
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '../src/services/db/client';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';
import { fetchGsmarenaSpecs } from '../src/services/catalog/adapters/gsmarena';
import {
  fetchWikipediaSpecs,
  checkWikipediaAvailability,
} from '../src/services/catalog/adapters/wikipedia';
import {
  brandPriorityRank,
  buildCanonicalKey,
  buildPromotionPlan,
  hashJson,
  promoteCatalogCandidate,
} from '../src/services/catalog';

const LOG = '[catalog:enrich]';

type CatalogCandidateRow = typeof catalogCandidates.$inferSelect;

function hasBrandAndModel(c: CatalogCandidateRow): c is CatalogCandidateRow & {
  normalizedIdentityJson: { brand: string; model: string };
} {
  const id = c.normalizedIdentityJson;
  return typeof id.brand === 'string' && typeof id.model === 'string';
}

async function main() {
  const db = getDb();

  // Check Wikipedia availability upfront so we know which sources are active.
  const wikiAvailable = await checkWikipediaAvailability();
  console.log(`${LOG} Wikipedia API available: ${wikiAvailable}`);

  const candidates = await db
    .select()
    .from(catalogCandidates)
    .where(inArray(catalogCandidates.decision, ['pending_review', 'quarantine', 'skip']));

  // Filter out candidates without brand/model, then sort by brand priority
  // so Apple, Samsung, Nothing, OnePlus, vivo, Xiaomi are always processed first.
  const pending = candidates.filter(hasBrandAndModel).sort((a, b) => {
    const rankA = brandPriorityRank(a.normalizedIdentityJson.brand);
    const rankB = brandPriorityRank(b.normalizedIdentityJson.brand);
    return rankA - rankB;
  });

  if (pending.length === 0) {
    console.log(`${LOG} No pending candidates to enrich.`);
    return;
  }

  console.log(`${LOG} Processing ${pending.length} candidates in brand-priority order.`);

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
      },
    })
    .returning({ id: catalogRuns.id });

  let updated = 0;
  let promoted = 0;
  let quarantined = 0;
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
        console.log(`  -> Found on Wikipedia ✓`);
      } else {
        console.log(`  -> Not found on Wikipedia; trying GSMArena fallback...`);
      }
    }

    // -----------------------------------------------------------------------
    // Tier 2: GSMArena (warm standby — may be blocked by Cloudflare Turnstile)
    // -----------------------------------------------------------------------
    if (!spec) {
      spec = await fetchGsmarenaSpecs(brand, model);
      if (spec) {
        gsmarenaHits++;
        sourceKey = 'gsmarena_specs';
        llmCalls++;
        console.log(`  -> Found on GSMArena ✓`);
      } else {
        console.log(`  -> Not found on either source — quarantining.`);
        quarantined++;
        continue;
      }
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
      spec,
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
        console.log(`  -> Promoted to catalog ✓ (action=${result.action})`);
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
        quarantinedCount: quarantined,
        llmCallCount: llmCalls,
        finishedAt: sql`now()`,
      })
      .where(eq(catalogRuns.id, run.id));
  }

  console.log(
    `${LOG} Done. Updated=${updated}, Promoted=${promoted}, Quarantined=${quarantined}, ` +
      `LLM Calls=${llmCalls}, Wikipedia Hits=${wikiHits}, GSMArena Hits=${gsmarenaHits}`,
  );
}

main().catch((err) => {
  console.error(`${LOG} FAILED`);
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

/**
 * Recommendation pipeline orchestrator — one multi-turn recommendation request.
 *
 * `runRecommendationPipeline(input)` handles the full lifecycle of a single
 * `/api/recommend` call:
 *   1. Load session context (prior requirements + prior picks).
 *   2. Detect if the user is refining over prior picks (refine intent).
 *   3. Extract structured preferences from the user message via LLM.
 *   4. Load the active phone catalog with aspect scores.
 *   5. Either refine-rank over prior picks or run a fresh full-catalog rank.
 *   6. Return `{ kind: 'results', picks, ... }` or `{ kind: 'clarify', ... }`.
 *
 * No streaming — returns a fully-resolved result synchronously. All I/O
 * happens via injected `db` and `llm` parameters (no global singletons).
 *
 * Used by: `src/app/api/recommend/route.ts`.
 */
import type { Logger } from 'pino';

import { ASPECT_NAMES, RECOMMENDER_CLARIFY_THRESHOLD, type AspectName } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';
import { aspectDefinitions } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import { latestAspectDefinitionsByAspect } from '@/services/scorecard/definitions';
import type { AspectDefinitionRow } from '@/services/scorecard/types';

import { loadRecommendationCatalog } from './catalog';
import { extractUserRequirements } from './extract-requirements';
import { aspectsByWeight, rankCandidates, type RankResult, type ScoredCandidate } from './match';
import { detectRefineIntent } from './refine-intent';
import type { UserRequirements } from './requirements-schema';
import { buildRecommenderQueryText } from './spec-embedding-text';
import { getLatestRecommendPickIds, getLatestRequirementsForSession } from './session';

export type RecommendApiPick = {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
  /** Postgres `msrp_usd` as string, or `null` */
  readonly msrpUsd: string | null;
  /** `phones.image_url` */
  readonly imageUrl: string | null;
};

export type RecommendPipelineResult =
  | {
      readonly kind: 'clarify';
      readonly requirements: UserRequirements;
      readonly clarifyingQuestion: string;
    }
  | {
      readonly kind: 'results';
      readonly requirements: UserRequirements;
      readonly picks: readonly RecommendApiPick[];
      readonly relaxed: readonly string[];
      /** `true` when this turn re-ranked the previous turn's picks instead of the full catalog. */
      readonly refined: boolean;
      /** `true` when all returned picks tie on score (within `SCORE_TIE_EPSILON`). */
      readonly scoresTied: boolean;
      /** `true` when none of the returned picks have real scorecard data. */
      readonly scorecardMissing: boolean;
      /** Top 1–2 aspect names driving the ranking, highest weight first. */
      readonly topAspects: readonly string[];
    };

function buildDefaultAspectWeights(
  dbRows: readonly AspectDefinitionRow[],
): Map<AspectName, number> {
  const latest = latestAspectDefinitionsByAspect(dbRows);
  const raw = new Map<AspectName, number>();
  let sum = 0;
  for (const name of ASPECT_NAMES) {
    const d = latest.get(name);
    const w = d ? Number.parseFloat(d.defaultWeight) : 1 / ASPECT_NAMES.length;
    const safe = Number.isFinite(w) && w > 0 ? w : 1 / ASPECT_NAMES.length;
    raw.set(name, safe);
    sum += safe;
  }
  return new Map([...raw].map(([k, v]) => [k, v / sum]));
}

function toApiPicks(picks: readonly ScoredCandidate[]): RecommendApiPick[] {
  return picks.map((p) => ({
    phoneId: p.phoneId,
    slug: p.slug,
    brand: p.brand,
    model: p.model,
    score: Math.round(p.score * 100) / 100,
    summary: p.summary,
    msrpUsd: p.msrpUsd,
    imageUrl: p.imageUrl,
  }));
}

function hasActionableRecommendationInput(requirements: UserRequirements): boolean {
  const hasBudget = requirements.budget_usd?.max != null || requirements.budget_usd?.min != null;
  const hasPreference =
    requirements.priorities.length > 0 ||
    requirements.use_cases.length > 0 ||
    requirements.must_haves.length > 0 ||
    requirements.brand_preference.liked.length > 0 ||
    requirements.brand_preference.disliked.length > 0 ||
    requirements.form_factor != null;

  return hasBudget && hasPreference;
}

function promoteRequirements(
  requirements: UserRequirements,
  options: { readonly forceAfterClarify: boolean },
): UserRequirements {
  if (!hasActionableRecommendationInput(requirements) && !options.forceAfterClarify) {
    return requirements;
  }

  return {
    ...requirements,
    confidence: Math.max(requirements.confidence, RECOMMENDER_CLARIFY_THRESHOLD),
    clarifying_question: undefined,
  };
}

export async function runRecommendationPipeline(input: {
  readonly db: AppDb;
  readonly llm: LlmProvider;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly log: Logger;
}): Promise<RecommendPipelineResult> {
  const [previous, priorPickIds] = await Promise.all([
    getLatestRequirementsForSession(input.db, input.sessionId),
    getLatestRecommendPickIds(input.db, input.sessionId),
  ]);

  const extracted = await extractUserRequirements({
    llm: input.llm,
    userMessage: input.userMessage,
    previous,
  });
  const hadPriorClarify = previous != null && previous.confidence < RECOMMENDER_CLARIFY_THRESHOLD;
  const requirements = promoteRequirements(extracted, { forceAfterClarify: hadPriorClarify });

  if (requirements.confidence < RECOMMENDER_CLARIFY_THRESHOLD) {
    const q =
      requirements.clarifying_question?.trim() ||
      'What budget works for you, and what is the single most important thing (camera, battery, gaming, etc.)?';
    input.log.info({ confidence: requirements.confidence, hadPriorClarify }, 'recommender clarify');
    return { kind: 'clarify', requirements, clarifyingQuestion: q };
  }

  const refineDetection = detectRefineIntent(input.userMessage);
  const refineEligible = refineDetection.refine && priorPickIds != null && priorPickIds.length > 0;

  const defRows = await input.db.select().from(aspectDefinitions);
  const defaultW = buildDefaultAspectWeights(defRows);
  const fullCatalog = await loadRecommendationCatalog(input.db);

  const hasSpecEmb = fullCatalog.some((c) => c.specEmbedding && c.specEmbedding.length > 0);
  let queryEmbedding: readonly number[] | undefined;
  if (hasSpecEmb) {
    const qtext = buildRecommenderQueryText(requirements);
    const emb = await input.llm.embed([qtext]);
    queryEmbedding = emb.embeddings[0];
  } else {
    input.log.info(
      'no phones.spec_embedding rows — skipping query embed (run pnpm spec-embed:backfill)',
    );
  }

  let picks: readonly ScoredCandidate[] = [];
  let rankResult: RankResult | null = null;
  let refined = false;

  if (refineEligible) {
    const priorIdSet = new Set(priorPickIds);
    const narrowed = fullCatalog.filter((entry) => priorIdSet.has(entry.phoneId));
    if (narrowed.length > 0) {
      const res = rankCandidates(narrowed, requirements, defaultW, {
        queryEmbedding,
        refined: true,
      });
      if (res.picks.length > 0) {
        picks = res.picks;
        rankResult = res;
        refined = true;
        input.log.info(
          {
            priorCount: priorPickIds.length,
            narrowedCount: narrowed.length,
            refinePicks: picks.length,
            refineMatched: refineDetection.matched,
            scoresTied: res.scoresTied,
            scorecardMissing: res.scorecardMissing,
          },
          'recommender refine over prior picks',
        );
      }
    }
    if (!refined) {
      input.log.info(
        {
          priorCount: priorPickIds.length,
          narrowedCount: narrowed.length,
          refineMatched: refineDetection.matched,
        },
        'refine detected but prior picks did not survive filters — falling back to full catalog',
      );
    }
  }

  if (!refined) {
    const res = rankCandidates(fullCatalog, requirements, defaultW, { queryEmbedding });
    picks = res.picks;
    rankResult = res;
  }

  // `rankResult` is populated whichever branch ran above.
  const result = rankResult!;
  const relaxed = result.relaxed;
  const topAspects = aspectsByWeight(result.weights).slice(0, 2);

  input.log.info(
    {
      pickCount: picks.length,
      relaxed,
      refined,
      scoresTied: result.scoresTied,
      scorecardMissing: result.scorecardMissing,
    },
    'recommender results',
  );

  return {
    kind: 'results',
    requirements,
    picks: toApiPicks(picks),
    relaxed,
    refined,
    scoresTied: result.scoresTied,
    scorecardMissing: result.scorecardMissing,
    topAspects,
  };
}

import type { Logger } from 'pino';

import { ASPECT_NAMES, RECOMMENDER_CLARIFY_THRESHOLD, type AspectName } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';
import { aspectDefinitions } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import { latestAspectDefinitionsByAspect } from '@/services/scorecard/definitions';
import type { AspectDefinitionRow } from '@/services/scorecard/types';

import { loadRecommendationCatalog } from './catalog';
import { extractUserRequirements } from './extract-requirements';
import { rankCandidates, type ScoredCandidate } from './match';
import type { UserRequirements } from './requirements-schema';
import { buildRecommenderQueryText } from './spec-embedding-text';
import { getLatestRequirementsForSession } from './session';

export type RecommendApiPick = {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
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
  }));
}

export async function runRecommendationPipeline(input: {
  readonly db: AppDb;
  readonly llm: LlmProvider;
  readonly sessionId: string;
  readonly userMessage: string;
  readonly log: Logger;
}): Promise<RecommendPipelineResult> {
  const previous = await getLatestRequirementsForSession(input.db, input.sessionId);
  const requirements = await extractUserRequirements({
    llm: input.llm,
    userMessage: input.userMessage,
    previous,
  });

  if (requirements.confidence < RECOMMENDER_CLARIFY_THRESHOLD) {
    const q =
      requirements.clarifying_question?.trim() ||
      'What budget works for you, and what is the single most important thing (camera, battery, gaming, etc.)?';
    input.log.info({ confidence: requirements.confidence }, 'recommender clarify');
    return { kind: 'clarify', requirements, clarifyingQuestion: q };
  }

  const defRows = await input.db.select().from(aspectDefinitions);
  const defaultW = buildDefaultAspectWeights(defRows);
  const catalog = await loadRecommendationCatalog(input.db);

  const hasSpecEmb = catalog.some((c) => c.specEmbedding && c.specEmbedding.length > 0);
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

  const { picks, relaxed } = rankCandidates(catalog, requirements, defaultW, { queryEmbedding });

  input.log.info({ pickCount: picks.length, relaxed }, 'recommender results');

  return {
    kind: 'results',
    requirements,
    picks: toApiPicks(picks),
    relaxed,
  };
}

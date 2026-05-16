/**
 * Recommender service barrel — conversational phone recommendation engine.
 *
 * Re-exports the public surface of the recommender subsystem:
 * - `catalog.ts`: load active phones with spec + aspect scores.
 * - `extract-requirements.ts`: LLM structured-output preference extraction.
 * - `match.ts`: hard/soft filters, aspect scoring, diversity, spec-semantic bump.
 * - `run-recommendation.ts`: orchestrate one multi-turn recommendation request.
 * - `session.ts`: anonymous session CRUD (create, load, append turns).
 * - `requirements-schema.ts`: Zod schema for `UserRequirements`.
 * - `spec-embedding-text.ts`: build embedding documents for `phones.spec_embedding`.
 *
 * Used by: `src/app/api/recommend/route.ts`.
 */
export { buildRecommenderQueryText, buildSpecDocumentForEmbedding } from './spec-embedding-text';
export { loadRecommendationCatalog, type PhoneCatalogEntry } from './catalog';
export { extractUserRequirements } from './extract-requirements';
export {
  buildSearchHaystack,
  dealBreakerHit,
  mustHaveMatchRatio,
  passesHardFilters,
  pickDiverseTop,
  rankCandidates,
  resolveAspectWeights,
  specSemanticBonus,
  weightedAspectScore,
  type ScoredCandidate,
} from './match';
export { cosineSimilarity, parseVectorColumn } from './vector-utils';
export {
  normalizeUserRequirements,
  userRequirementsSchema,
  type UserRequirements,
} from './requirements-schema';
export {
  runRecommendationPipeline,
  type RecommendApiPick,
  type RecommendPipelineResult,
} from './run-recommendation';
export {
  findSessionByCookie,
  getLatestRequirementsForSession,
  insertRecommendationSession,
  nextTurnIndex,
} from './session';

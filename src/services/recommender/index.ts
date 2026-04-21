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

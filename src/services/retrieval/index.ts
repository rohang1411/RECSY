/**
 * Retrieval service — public API.
 *
 * Consumers should import from this barrel and never reach into sibling
 * files directly. See `docs/retrieval/README.md` for the operator /
 * developer guide, and `docs/adr/0004-hybrid-retrieval.md` for the
 * composition rationale.
 */
export type {
  RetrievedChunk,
  RetrievedSource,
  RetrievalRequest,
  RetrievalOptions,
  RetrievalResult,
  RetrievalDebug,
  Retriever,
} from './types';
export { DEFAULT_OPTIONS } from './types';

export { VectorSearch } from './vector';
export type { VectorSearchDeps, VectorSearchOptions } from './vector';

export { FtsSearch, sanitiseQuery } from './fts';
export type { FtsSearchDeps } from './fts';

export { reciprocalRankFusion } from './rrf';
export type { FusedChunk, RrfOptions } from './rrf';

export { mmrRerank, cosineSimilarity } from './mmr';
export type { MmrOptions } from './mmr';

export { enforceSourceCoverage } from './coverage';
export type { CoverageOptions, CoverageResult } from './coverage';

export { HybridRetriever } from './retriever';
export type { HybridRetrieverDeps, HybridSearchInput } from './retriever';

export { createHybridRetriever } from './factory';

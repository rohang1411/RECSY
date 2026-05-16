/**
 * Scorecard pipeline constants.
 *
 * Centralises retrieval knobs, confidence thresholds, and recency windows
 * for the scorecard extraction pipeline. Changing these values adjusts
 * behaviour across `agent.ts`, `query-build.ts`, and `recency.ts` without
 * touching algorithm code.
 *
 * Used by: `src/services/scorecard/{agent,query-build,recency,staleness}.ts`.
 */
/** Byte cap on the combined retrieval query built from `query_prompts`. */
export const SCORECARD_COMBINED_QUERY_MAX_BYTES = 2_048;

/** Hybrid retrieval knobs — one embed + search per aspect (see ADR 0006). */
export const SCORECARD_K_PER_RETRIEVER = 30;
export const SCORECARD_TARGET_RESULTS = 8;
/** Softer than Q&A so thin corpora still return context. */
export const SCORECARD_MIN_DISTINCT_SOURCES = 2;

/** Sources published within this window count as “fresh” for confidence boost. */
export const SCORECARD_RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * Application-wide constants. Feature-specific constants live alongside
 * their feature (`src/features/<feature>/constants.ts`).
 *
 * Never inline magic numbers in logic code — promote them here and explain
 * what they represent.
 */

/** Maximum length of a user chat message (bytes). Protects LLM + DB. */
export const MAX_CHAT_MESSAGE_BYTES = 4_000;

/** Maximum length of a recommender intake message (bytes). */
export const MAX_RECOMMENDER_MESSAGE_BYTES = 2_000;

/** Default top-k chunks returned from hybrid retrieval before reranking. */
export const RETRIEVAL_TOP_K_PRE_RERANK = 40;

/** Chunks passed to the LLM as context after reranking. */
export const RETRIEVAL_TOP_K_POST_RERANK = 8;

/** Minimum number of distinct sources that must appear in the final citation set. */
export const MIN_DISTINCT_SOURCES_IN_CONTEXT = 3;

/** MMR diversity lambda (0 = max diversity, 1 = max relevance). */
export const MMR_LAMBDA = 0.6;

/** Preference-extraction confidence below which we ask a clarifying question. */
export const RECOMMENDER_CLARIFY_THRESHOLD = 0.6;

/** Aspect dimensions scored per phone. Kept in sync with `aspect_definitions`. */
export const ASPECT_NAMES = [
  'camera',
  'battery',
  'performance',
  'display',
  'build',
  'software',
  'value',
] as const;

export type AspectName = (typeof ASPECT_NAMES)[number];

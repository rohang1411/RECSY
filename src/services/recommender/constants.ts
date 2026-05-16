/**
 * Recommender pipeline constants.
 *
 * Centralises all numeric and flag constants used by the matching,
 * ranking, and diversity logic so they can be tuned in one place
 * without touching algorithm code.
 *
 * Used by: `src/services/recommender/{match,run-recommendation}.ts`
 * and their test files.
 */
/** How many phones we surface after ranking (Stage C MVP — no Pro tie-break). */
export const RECOMMEND_TOP_PICKS = 3;

/** Diversity cap per brand in the pick list (§11 Stage B). */
export const RECOMMEND_MAX_PER_BRAND = 2;

/** When strict filters return zero candidates, widen budget by this factor once. */
export const RECOMMEND_BUDGET_RELAX_FACTOR = 1.2;

/** Bonus added to the composite score (0–10 scale) when the user liked a brand. */
export const RECOMMEND_LIKED_BRAND_BONUS = 0.35;

/**
 * Max additive boost from `query_embedding` vs `phones.spec_embedding` cosine
 * (after mapping similarity to 0..1). Phones without `spec_embedding` get 0.
 */
export const RECOMMEND_SPEC_SIMANTIC_BUMP = 0.45;

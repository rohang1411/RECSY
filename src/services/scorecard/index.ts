/**
 * Scorecard service barrel — 7-axis aspect scorecard generation.
 *
 * Re-exports the public surface of the scorecard subsystem:
 * - `agent.ts`: `runScorecardForPhone`, `runSingleAspect`, `loadPhoneBySlug`.
 * - `definitions.ts`: `latestAspectDefinitionsByAspect`.
 * - `query-build.ts`: `buildCombinedRetrievalQuery`.
 * - `recency.ts`: `computeRecencyBump`.
 * - `staleness.ts`: `isScorecardStale`.
 * - `scheduler.ts`: `pickStalestPhones`.
 *
 * The scorecard pipeline retrieves chunks, extracts aspect signals via
 * structured LLM output, and upserts `aspects` rows. Telemetry is written
 * to `scorecard_runs`. See ADR 0006 and ADR 0015.
 *
 * Used by: `scripts/scorecard-run.ts`, `scripts/scorecard-auto.ts`,
 *          `src/app/p/[slug]/page.tsx` (reads `aspects` rows for display).
 */
export {
  loadPhoneBySlug,
  runScorecardForPhone,
  runSingleAspect,
  type ScorecardRunContext,
} from './agent';
export { latestAspectDefinitionsByAspect } from './definitions';
export { buildCombinedRetrievalQuery } from './query-build';
export { recencyConfidenceBoost } from './recency';
export {
  aspectScorecardExtractionSchema,
  type AspectScorecardExtraction,
} from './extraction-schema';
export {
  pickScorecardPhones,
  markScorecardComplete,
  bootstrapNextScorecardAt,
  type ScorecardPickedPhone,
} from './scheduler';
export { computeChunkFingerprint, getLastScorecardFingerprint } from './staleness';
export type { AspectDefinitionRow, AspectRow, ScorecardQuote } from './types';

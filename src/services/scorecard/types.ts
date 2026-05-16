/**
 * Shared TypeScript types for the scorecard subsystem.
 *
 * Exports Drizzle-inferred row types (`AspectDefinitionRow`, `AspectRow`)
 * so other modules can reference the DB shape without importing schema
 * directly. Keeps the type surface in one place.
 *
 * Used by: `src/services/scorecard/{agent,definitions,scheduler,staleness}.ts`,
 *          `src/services/recommender/catalog.ts`.
 */
import type { aspects, aspectDefinitions } from '@/services/db/schema';

/** Row shape from `aspect_definitions` (Drizzle-inferred). */
export type AspectDefinitionRow = typeof aspectDefinitions.$inferSelect;

/** Row shape from `aspects`. */
export type AspectRow = typeof aspects.$inferSelect;

/** Normalised quote stored in `supporting_quotes` / `dissenting_quotes` JSON. */
export interface ScorecardQuote {
  readonly chunkId: string;
  readonly excerpt: string;
  readonly sourceTitle?: string;
}

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

/**
 * Zod schema for scorecard structured-output extraction.
 *
 * Defines the shape that Gemini must return for each aspect extraction:
 * a `score` (1–10), `confidence` (`low|medium|high`), a `summary` string,
 * and an `evidence` array of `{ chunkId, quote }` objects. `chunkId` is
 * validated as a UUID to prevent hallucinated source references.
 *
 * The schema is intentionally strict — a validation failure is retried with
 * an error-feedback nudge (see `GeminiProvider.structured`).
 *
 * Used by: `src/services/scorecard/agent.ts`.
 */
import { z } from 'zod';

const uuidStr = z.string().uuid();

export const scorecardEvidenceItemSchema = z.object({
  chunkId: uuidStr,
  excerpt: z.string().min(1).max(360),
});

export const aspectScorecardExtractionSchema = z.object({
  overallScore: z.coerce.number().min(0).max(10),
  confidence: z.coerce.number().min(0).max(1),
  summary: z.string().min(1).max(900),
  supporting: z.array(scorecardEvidenceItemSchema).max(4).default([]),
  dissenting: z.array(scorecardEvidenceItemSchema).max(3).default([]),
});

export type AspectScorecardExtraction = z.infer<typeof aspectScorecardExtractionSchema>;

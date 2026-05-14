import { z } from 'zod';

const uuidStr = z.string();

export const scorecardEvidenceItemSchema = z.object({
  chunkId: uuidStr,
  excerpt: z.string().min(1),
});

export const aspectScorecardExtractionSchema = z.object({
  overallScore: z.coerce.number().min(0).max(10),
  confidence: z.coerce.number().min(0).max(1),
  summary: z.string().min(1),
  supporting: z.array(scorecardEvidenceItemSchema).default([]),
  dissenting: z.array(scorecardEvidenceItemSchema).default([]),
});

export type AspectScorecardExtraction = z.infer<typeof aspectScorecardExtractionSchema>;

import { z } from 'zod';

const uuidStr = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const scorecardEvidenceItemSchema = z.object({
  chunkId: uuidStr,
  excerpt: z.string().min(1).max(400),
});

export const aspectScorecardExtractionSchema = z.object({
  overallScore: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(1).max(900),
  supporting: z.array(scorecardEvidenceItemSchema).max(8).default([]),
  dissenting: z.array(scorecardEvidenceItemSchema).max(5).default([]),
});

export type AspectScorecardExtraction = z.infer<typeof aspectScorecardExtractionSchema>;

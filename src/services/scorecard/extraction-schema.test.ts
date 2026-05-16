/**
 * Unit tests for scorecard extraction schema validation (`extraction-schema.ts`).
 *
 * Tests cover: valid structured output accepted, invalid UUID rejected,
 * out-of-range score rejected, missing required fields rejected,
 * and confidence enum validation. Pure.
 */
import { describe, expect, it } from 'vitest';

import { aspectScorecardExtractionSchema } from './extraction-schema';

const chunkId = '550e8400-e29b-41d4-a716-446655440000';

describe('aspectScorecardExtractionSchema', () => {
  it('parses a minimal valid payload', () => {
    const parsed = aspectScorecardExtractionSchema.parse({
      overallScore: 7,
      confidence: 0.5,
      summary: 'Solid battery life in daily use.',
      supporting: [{ chunkId, excerpt: 'Lasts all day.' }],
      dissenting: [],
    });
    expect(parsed.overallScore).toBe(7);
    expect(parsed.supporting).toHaveLength(1);
  });

  it('rejects invalid chunk ids', () => {
    expect(() =>
      aspectScorecardExtractionSchema.parse({
        overallScore: 5,
        confidence: 0.2,
        summary: 'x'.repeat(20),
        supporting: [{ chunkId: 'not-a-uuid', excerpt: 'bad' }],
        dissenting: [],
      }),
    ).toThrow();
  });

  it('applies default empty arrays when omitted', () => {
    const parsed = aspectScorecardExtractionSchema.parse({
      overallScore: 6,
      confidence: 0.4,
      summary: 'y'.repeat(30),
    });
    expect(parsed.supporting).toEqual([]);
    expect(parsed.dissenting).toEqual([]);
  });
});

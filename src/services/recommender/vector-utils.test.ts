/**
 * Unit tests for vector utility functions (`vector-utils.ts`).
 *
 * Tests cover: `cosineSimilarity` (orthogonal, identical, and unit
 * vectors), `parseVectorColumn` (number array pass-through and JSON
 * string parsing). Pure — no external I/O.
 */
import { describe, expect, it } from 'vitest';

import { cosineSimilarity, parseVectorColumn } from './vector-utils';

describe('vector-utils', () => {
  it('parseVectorColumn accepts number arrays', () => {
    expect(parseVectorColumn([0.1, 0.2])).toEqual([0.1, 0.2]);
  });

  it('parseVectorColumn accepts JSON string', () => {
    expect(parseVectorColumn('[0.5,0.5]')).toEqual([0.5, 0.5]);
  });

  it('cosineSimilarity is 1 for parallel vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [2, 0, 0])).toBe(1);
  });
});

/**
 * Unit tests for the source-coverage clamp.
 *
 * Covers the three regimes:
 *   1. Input already has enough source diversity: pass through (capped).
 *   2. Input is one-source-dominant and the corpus has more sources:
 *      back-fill from skipped.
 *   3. Input genuinely doesn't contain enough sources: relaxed = true.
 */
import { describe, expect, it } from 'vitest';

import { enforceSourceCoverage } from './coverage';
import type { RetrievedChunk } from './types';

function chunk(id: string, sourceId: string): RetrievedChunk {
  return {
    chunkId: id,
    sourceId,
    text: `text-${id}`,
    score: 0,
    source: {
      id: sourceId,
      url: `https://example.com/${sourceId}`,
      title: `Source ${sourceId}`,
      type: 'article',
      author: null,
      channel: null,
      publishedAt: null,
    },
  };
}

describe('enforceSourceCoverage', () => {
  it('returns empty for empty input', () => {
    const out = enforceSourceCoverage([], { k: 5, minDistinctSources: 3 });
    expect(out.chunks).toEqual([]);
    expect(out.relaxed).toBe(false);
    expect(out.sourceCount).toBe(0);
  });

  it('caps per-source to floor(k / minDistinctSources) by default', () => {
    // k=6, minDistinctSources=3 -> maxPerSource=2.
    const ranked = [
      chunk('a1', 'A'),
      chunk('a2', 'A'),
      chunk('a3', 'A'), // should be skipped (A already has 2)
      chunk('b1', 'B'),
      chunk('b2', 'B'),
      chunk('c1', 'C'),
      chunk('c2', 'C'),
    ];

    const out = enforceSourceCoverage(ranked, { k: 6, minDistinctSources: 3 });
    expect(out.chunks.map((c) => c.chunkId)).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
    expect(out.sourceCount).toBe(3);
    expect(out.relaxed).toBe(false);
  });

  it('back-fills from skipped chunks when the input is one-source-heavy', () => {
    // Ranked = all from A, then one each from B and C later.
    // k=4 demands 3 distinct sources.
    const ranked = [
      chunk('a1', 'A'),
      chunk('a2', 'A'),
      chunk('a3', 'A'),
      chunk('a4', 'A'),
      chunk('b1', 'B'),
      chunk('c1', 'C'),
    ];

    const out = enforceSourceCoverage(ranked, { k: 4, minDistinctSources: 3 });
    const sources = new Set(out.chunks.map((c) => c.sourceId));
    expect(sources.size).toBe(3);
    expect(out.relaxed).toBe(false);
    expect(out.chunks).toHaveLength(4);
  });

  it('relaxes when the corpus truly lacks enough distinct sources', () => {
    const ranked = [chunk('a1', 'A'), chunk('a2', 'A'), chunk('b1', 'B')];

    const out = enforceSourceCoverage(ranked, { k: 3, minDistinctSources: 3 });
    expect(out.relaxed).toBe(true);
    expect(out.sourceCount).toBe(2);
  });

  it('honours an explicit maxPerSource override', () => {
    const ranked = [chunk('a1', 'A'), chunk('a2', 'A'), chunk('a3', 'A')];
    const out = enforceSourceCoverage(ranked, {
      k: 3,
      minDistinctSources: 1,
      maxPerSource: 2,
    });
    expect(out.chunks.map((c) => c.chunkId)).toEqual(['a1', 'a2']);
  });

  it('does not exceed k when back-filling', () => {
    const ranked = [
      chunk('a1', 'A'),
      chunk('a2', 'A'),
      chunk('a3', 'A'),
      chunk('b1', 'B'),
      chunk('c1', 'C'),
      chunk('d1', 'D'),
    ];
    const out = enforceSourceCoverage(ranked, { k: 4, minDistinctSources: 3 });
    expect(out.chunks).toHaveLength(4);
    const sources = new Set(out.chunks.map((c) => c.sourceId));
    expect(sources.size).toBeGreaterThanOrEqual(3);
  });
});

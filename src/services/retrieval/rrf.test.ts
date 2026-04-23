/**
 * Unit tests for Reciprocal Rank Fusion.
 *
 * RRF is pure math — these tests hold the maths to account so the formula
 * can't silently drift under a refactor.
 */
import { describe, expect, it } from 'vitest';

import { reciprocalRankFusion } from './rrf';
import type { RetrievedChunk } from './types';

function chunk(id: string, overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: id,
    sourceId: `src-${id}`,
    text: `text for ${id}`,
    score: 0,
    source: {
      id: `src-${id}`,
      url: `https://example.com/${id}`,
      title: `Source ${id}`,
      type: 'article',
      author: null,
      channel: null,
      publishedAt: null,
    },
    ...overrides,
  };
}

describe('reciprocalRankFusion', () => {
  it('returns [] when given no input lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });

  it('returns a single list unchanged in order (scores are 1/(k+rank))', () => {
    const a = chunk('a');
    const b = chunk('b');
    const c = chunk('c');

    const fused = reciprocalRankFusion([{ retriever: 'vector', chunks: [a, b, c] }], { k: 60 });

    expect(fused.map((f) => f.chunkId)).toEqual(['a', 'b', 'c']);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
    expect(fused[1]!.score).toBeCloseTo(1 / 62, 10);
    expect(fused[2]!.score).toBeCloseTo(1 / 63, 10);
  });

  it('sums contributions across retrievers for chunks that appear in both', () => {
    const a = chunk('a');
    const b = chunk('b');

    const fused = reciprocalRankFusion(
      [
        { retriever: 'vector', chunks: [a, b] },
        { retriever: 'fts', chunks: [b, a] },
      ],
      { k: 60 },
    );

    expect(fused).toHaveLength(2);
    const byId = new Map(fused.map((f) => [f.chunkId, f]));

    // Both chunks saw rank 1 once and rank 2 once, so their fused scores
    // are identical: 1/61 + 1/62.
    const expected = 1 / 61 + 1 / 62;
    expect(byId.get('a')!.score).toBeCloseTo(expected, 10);
    expect(byId.get('b')!.score).toBeCloseTo(expected, 10);
  });

  it('breaks ties by insertion order (first retriever that surfaced the chunk wins)', () => {
    const a = chunk('a');
    const b = chunk('b');

    const fused = reciprocalRankFusion(
      [
        { retriever: 'vector', chunks: [a, b] },
        { retriever: 'fts', chunks: [b, a] }, // tied: both at rank 1+2 across lists
      ],
      { k: 60 },
    );

    // a was seen first (vector rank 1), so it wins the tie.
    expect(fused.map((f) => f.chunkId)).toEqual(['a', 'b']);
  });

  it('records per-retriever contributions (1-indexed) for observability', () => {
    const a = chunk('a');
    const b = chunk('b');

    const fused = reciprocalRankFusion([
      { retriever: 'vector', chunks: [a, b] },
      { retriever: 'fts', chunks: [b] },
    ]);

    const aContribs = fused.find((f) => f.chunkId === 'a')!.rrfContributions;
    const bContribs = fused.find((f) => f.chunkId === 'b')!.rrfContributions;

    expect(aContribs).toEqual([{ retriever: 'vector', rank: 1 }]);
    expect(bContribs).toEqual([
      { retriever: 'vector', rank: 2 },
      { retriever: 'fts', rank: 1 },
    ]);
  });

  it('is unaffected by each retriever internal score (rank-based only)', () => {
    // Same chunks in the same order but wildly different raw scores.
    const a = chunk('a', { score: 999 });
    const b = chunk('b', { score: 0.001 });

    const fused = reciprocalRankFusion([{ retriever: 'vector', chunks: [a, b] }]);
    expect(fused.map((f) => f.chunkId)).toEqual(['a', 'b']);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
  });

  it('does not mutate its inputs', () => {
    const a = chunk('a');
    const b = chunk('b');
    const listA = [a, b];
    const listB = [b, a];

    reciprocalRankFusion([
      { retriever: 'vector', chunks: listA },
      { retriever: 'fts', chunks: listB },
    ]);

    expect(listA).toEqual([a, b]);
    expect(listB).toEqual([b, a]);
  });

  it('respects the k parameter (larger k compresses the score range)', () => {
    const a = chunk('a');
    const fusedK60 = reciprocalRankFusion([{ retriever: 'vector', chunks: [a] }], { k: 60 });
    const fusedK10 = reciprocalRankFusion([{ retriever: 'vector', chunks: [a] }], { k: 10 });

    // k=10 at rank 1 -> 1/11; k=60 at rank 1 -> 1/61. The k=10 score is larger.
    expect(fusedK10[0]!.score).toBeGreaterThan(fusedK60[0]!.score);
  });
});

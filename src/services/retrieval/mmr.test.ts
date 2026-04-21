/**
 * Unit tests for MMR reranking.
 *
 * We pin the maths (lambda interpretation, ordering, diversity penalty)
 * so the formula can't drift under refactors.
 */
import { describe, expect, it } from 'vitest';

import { cosineSimilarity, mmrRerank } from './mmr';
import type { RetrievedChunk } from './types';

function chunk(id: string, score: number, embedding?: readonly number[]): RetrievedChunk {
  return {
    chunkId: id,
    sourceId: `src-${id}`,
    text: `text for ${id}`,
    score,
    embedding,
    source: {
      id: `src-${id}`,
      url: `https://example.com/${id}`,
      title: `Source ${id}`,
      type: 'article',
      author: null,
      channel: null,
      publishedAt: null,
    },
  };
}

describe('mmrRerank', () => {
  it('returns [] for empty input', () => {
    expect(mmrRerank([])).toEqual([]);
  });

  it('is identity when lambda = 1 (pure relevance)', () => {
    const a = chunk('a', 0.9, [1, 0, 0]);
    const b = chunk('b', 0.8, [1, 0, 0]); // near-duplicate of a
    const c = chunk('c', 0.5, [0, 1, 0]); // very different

    const out = mmrRerank([a, b, c], { lambda: 1 });
    expect(out.map((o) => o.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('breaks near-duplicate runs in favour of diverse picks (lambda = 0.5)', () => {
    // a and b are identical in embedding space. MMR should pick a first
    // (highest relevance), then prefer c over b because b duplicates a.
    const a = chunk('a', 0.9, [1, 0, 0]);
    const b = chunk('b', 0.8, [1, 0, 0]);
    const c = chunk('c', 0.5, [0, 1, 0]);

    const out = mmrRerank([a, b, c], { lambda: 0.5 });
    expect(out.map((o) => o.chunkId)).toEqual(['a', 'c', 'b']);
  });

  it('with lambda = 0 selects purely for diversity (ignores relevance entirely)', () => {
    const a = chunk('a', 0.9, [1, 0, 0]);
    const b = chunk('b', 0.1, [0, 1, 0]);
    const c = chunk('c', 0.05, [0, 0, 1]);

    // First pick: a (relevance doesn't matter, but on empty selected
    // set every candidate has the same diversity score of 0, so
    // stability picks the first in input order). Then picks with
    // maximum distance from previously selected.
    const out = mmrRerank([a, b, c], { lambda: 0 });
    // Second pick: b or c both have sim=0 to a. Stable: first in input.
    expect(out.map((o) => o.chunkId)).toEqual(['a', 'b', 'c']);
  });

  it('respects the k cap', () => {
    const a = chunk('a', 0.9, [1, 0]);
    const b = chunk('b', 0.8, [0, 1]);
    const c = chunk('c', 0.7, [1, 1]);

    const out = mmrRerank([a, b, c], { k: 2 });
    expect(out).toHaveLength(2);
  });

  it('throws on out-of-range lambda', () => {
    expect(() => mmrRerank([], { lambda: -0.1 })).toThrow(/lambda/);
    expect(() => mmrRerank([], { lambda: 1.1 })).toThrow(/lambda/);
    expect(() => mmrRerank([], { lambda: Number.NaN })).toThrow(/lambda/);
  });

  it('does not mutate its input array', () => {
    const a = chunk('a', 0.9, [1, 0]);
    const b = chunk('b', 0.8, [0, 1]);
    const original = [a, b];
    const snapshot = [...original];
    mmrRerank(original);
    expect(original).toEqual(snapshot);
  });

  it('penalises chunks missing embeddings by default (treats them as duplicates)', () => {
    const a = chunk('a', 0.9, [1, 0, 0]);
    const noEmbed = chunk('b', 0.85 /* no embedding */);
    const diverse = chunk('c', 0.7, [0, 1, 0]);

    const out = mmrRerank([a, noEmbed, diverse], { lambda: 0.5 });
    // Missing embedding defaults to max-sim=1, which heavily penalises b
    // once a is selected. c wins over b despite lower relevance.
    expect(out.map((o) => o.chunkId)).toEqual(['a', 'c', 'b']);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
  });

  it('returns -1 for antipodal vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
  });

  it('returns 0 when either vector is zero (guard against NaN)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [0, 0])).toBe(0);
  });

  it('throws on mismatched dimensions', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/length mismatch/);
  });
});

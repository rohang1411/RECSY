import { describe, expect, it } from 'vitest';
import type { RetrievalResult, RetrievedChunk } from '@/services/retrieval/types';
import { CRAG_SIMILARITY_THRESHOLD, evaluateRetrievalConfidence } from './crag-gate';

function mockRetrieval(overrides: {
  chunks?: RetrievedChunk[];
  maxSimilarity?: number;
  ftsCount?: number;
}): RetrievalResult {
  return {
    chunks: overrides.chunks ?? [],
    debug: {
      phoneId: 'test-phone',
      query: 'test-query',
      vector: {
        count: (overrides.chunks ?? []).length,
        ms: 10,
        maxSimilarity: overrides.maxSimilarity,
      },
      fts: { count: overrides.ftsCount ?? 0, ms: 5 },
      rrf: { count: 0, ms: 1 },
      mmr: { count: 0, ms: 1 },
      coverage: { sourceCount: 1, relaxed: false },
      totalMs: 20,
    },
  };
}

describe('CRAG Pre-Inference Grounding Gate (WP-03)', () => {
  it('defines threshold at 0.72', () => {
    expect(CRAG_SIMILARITY_THRESHOLD).toBe(0.72);
  });

  it('abstains when chunk set is completely empty', () => {
    const res = evaluateRetrievalConfidence(mockRetrieval({ chunks: [] }));
    expect(res.action).toBe('abstain');
    expect(res.maxSimilarity).toBe(0);
    expect(res.reason).toBe('zero_chunks');
  });

  it('abstains when max similarity is below threshold and 0 FTS hits', () => {
    const chunk = { chunkId: 'c1', text: 'irrelevant', score: 0.61 } as unknown as RetrievedChunk;
    const res = evaluateRetrievalConfidence(
      mockRetrieval({
        chunks: [chunk],
        maxSimilarity: 0.61,
        ftsCount: 0,
      }),
    );
    expect(res.action).toBe('abstain');
    expect(res.maxSimilarity).toBe(0.61);
    expect(res.reason).toContain('insufficient_semantic_confidence');
  });

  it('permits synthesis when max vector similarity meets or exceeds 0.72', () => {
    const chunk = { chunkId: 'c1', text: 'good chunk', score: 0.75 } as unknown as RetrievedChunk;
    const res = evaluateRetrievalConfidence(
      mockRetrieval({
        chunks: [chunk],
        maxSimilarity: 0.75,
        ftsCount: 0,
      }),
    );
    expect(res.action).toBe('synthesize');
    expect(res.maxSimilarity).toBe(0.75);
  });

  it('permits synthesis when FTS hit exists even if vector similarity is low', () => {
    const chunk = {
      chunkId: 'c1',
      text: 'fts matched chunk',
      score: 0.65,
    } as unknown as RetrievedChunk;
    const res = evaluateRetrievalConfidence(
      mockRetrieval({
        chunks: [chunk],
        maxSimilarity: 0.65,
        ftsCount: 1,
      }),
    );
    expect(res.action).toBe('synthesize');
  });
});

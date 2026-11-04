import { describe, expect, it } from 'vitest';

import { buildAskRetrievalTrace } from './ask-retrieval-trace';
import type { RetrievalResult } from '@/services/retrieval/types';

const chunk = {
  chunkId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  sourceId: 'src-1',
  text: 'hello',
  score: 0.5,
  source: {
    id: 'src-1',
    url: 'https://example.com/a',
    title: 'Source A',
    type: 'article' as const,
    author: null,
    channel: null,
    publishedAt: null,
  },
};

const baseDebug = {
  phoneId: 'p1',
  query: 'q',
  vector: { count: 2, ms: 10 },
  fts: { count: 2, ms: 5 },
  rrf: { count: 2, ms: 1 },
  mmr: { count: 1, ms: 2 },
  coverage: { sourceCount: 1, relaxed: false },
  totalMs: 25,
} as const;

describe('buildAskRetrievalTrace', () => {
  it('flattens stages and source list', () => {
    const retrieval: RetrievalResult = {
      chunks: [chunk],
      debug: { ...baseDebug },
    };
    const t = buildAskRetrievalTrace(retrieval);
    expect(t.chunkCount).toBe(1);
    expect(t.distinctSourceCount).toBe(1);
    expect(t.sources[0]!.url).toBe('https://example.com/a');
    expect(t.stages.length).toBeGreaterThanOrEqual(4);
  });

  it('includes LLM rerank when present', () => {
    const retrieval: RetrievalResult = {
      chunks: [chunk],
      debug: {
        ...baseDebug,
        llmRerank: { ms: 100, poolSize: 8, applied: true },
      },
    };
    const t = buildAskRetrievalTrace(retrieval);
    expect(t.stages.some((s) => s.name.startsWith('LLM rerank'))).toBe(true);
  });

  it('populates evidenceChunks with citations and whyReferenced', () => {
    const youtubeChunk = {
      chunkId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
      sourceId: 'src-yt',
      text: 'Low light zoom test reveals crisp edges and minimal color noise.',
      score: 0.88,
      source: {
        id: 'src-yt',
        url: 'https://youtube.com/watch?v=123',
        title: 'Camera Shootout',
        type: 'youtube' as const,
        author: 'Marques Brownlee',
        channel: 'MKBHD',
        publishedAt: null,
      },
      startTs: 142,
    };
    const retrieval: RetrievalResult = {
      chunks: [chunk, youtubeChunk],
      debug: { ...baseDebug },
    };
    const citations = [
      {
        chunkId: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22',
        sourceUrl: 'https://youtube.com/watch?v=123&t=142',
        title: 'Camera Shootout',
        type: 'youtube' as const,
        anchor: null,
        startTs: 142,
      },
    ];
    const trace = buildAskRetrievalTrace(retrieval, citations);
    expect(trace.evidenceChunks).toHaveLength(2);

    const ytEvidence = trace.evidenceChunks.find((e) => e.chunkId === youtubeChunk.chunkId);
    expect(ytEvidence).toBeDefined();
    expect(ytEvidence?.isCited).toBe(true);
    expect(ytEvidence?.citationIndices).toEqual([1]);
    expect(ytEvidence?.channel).toBe('MKBHD');
    expect(ytEvidence?.whyReferenced).toContain('MKBHD');
    expect(ytEvidence?.sourceUrl).toContain('t=142');

    const uncitedEvidence = trace.evidenceChunks.find((e) => e.chunkId === chunk.chunkId);
    expect(uncitedEvidence?.isCited).toBe(false);
    expect(uncitedEvidence?.citationIndices).toEqual([]);
  });
});

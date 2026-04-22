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
});

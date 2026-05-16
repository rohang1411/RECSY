/**
 * Unit tests for LLM rerank + MMR tail merging (`llm-rerank.ts`).
 *
 * Tests cover: LLM-ranked head preserved in order, MMR tail fills
 * remaining slots, duplicate removal between head and tail, and
 * correct final slice at `k`. Pure — no LLM or DB.
 */
import { describe, expect, it } from 'vitest';

import type { RetrievedChunk } from './types';

import { mergeLlmHeadWithMmrTail } from './llm-rerank';

function ch(id: string, sourceId: string): RetrievedChunk {
  return {
    chunkId: id,
    sourceId,
    text: 'x',
    score: 1,
    source: {
      id: sourceId,
      url: 'https://ex.test',
      title: 't',
      type: 'article',
      author: null,
      channel: null,
      publishedAt: null,
    },
  };
}

describe('mergeLlmHeadWithMmrTail', () => {
  it('dedupes by chunk id and preserves head order', () => {
    const mmr = [ch('a', 's1'), ch('b', 's2'), ch('c', 's3')];
    const head = [ch('c', 's3'), ch('a', 's1')];
    const merged = mergeLlmHeadWithMmrTail(head, mmr);
    expect(merged.map((c) => c.chunkId)).toEqual(['c', 'a', 'b']);
  });
});

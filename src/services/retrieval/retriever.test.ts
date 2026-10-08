/**
 * Unit tests for the hybrid retriever orchestration.
 *
 * The scorecard pipeline repeats the same seven aspect queries across many
 * phones, so query embeddings must be cached within a run to avoid burning
 * Gemini request budget on identical query text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HybridRetriever, resetHybridRetrieverQueryEmbeddingCache } from './retriever';
import type { RetrievedChunk, Retriever } from './types';

function makeRetriever(): Retriever {
  return {
    name: 'stub',
    search: vi.fn().mockResolvedValue([]),
  };
}

function makeLog() {
  return {
    child: vi.fn().mockReturnThis(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe('HybridRetriever query embedding cache', () => {
  it('quarantines a reviewed false source assertion before fusion in both branches', async () => {
    const chunk: RetrievedChunk = {
      chunkId: '8ffc6cee-7841-4ca0-a440-38c4247661eb',
      sourceId: 's',
      text: 'Incorrect port claim',
      score: 1,
      source: {
        id: 's',
        title: 'Review',
        url: 'https://example.com',
        type: 'article',
        author: null,
        channel: null,
        publishedAt: null,
      },
    };
    const branch = { name: 'test', search: vi.fn().mockResolvedValue([chunk]) };
    const retriever = new HybridRetriever({
      vector: branch,
      fts: branch,
      log: makeLog() as never,
      llm: {
        name: 'test',
        chat: vi.fn(),
        chatStream: vi.fn(),
        structured: vi.fn(),
        embed: vi
          .fn()
          .mockResolvedValue({ embeddings: [[1, 0]], model: 'test', usage: { tokensIn: 0 } }),
      },
    });
    const result = await retriever.search({ phoneId: 'p', query: 'port' });
    expect(result.chunks).toEqual([]);
    expect(result.debug.sourceQuality?.excludedChunkIds).toEqual([chunk.chunkId]);
    expect(result.debug.rrf.count).toBe(0);
    branch.search.mockResolvedValue([chunk, { ...chunk, chunkId: 'clean-chunk' }]);
    const mixed = await retriever.search({ phoneId: 'p', query: 'port' });
    expect(mixed.chunks.map((c) => c.chunkId)).toEqual(['clean-chunk']);
    expect(mixed.debug.rrf.count).toBe(1);
  });
  beforeEach(() => {
    resetHybridRetrieverQueryEmbeddingCache();
  });

  it('reuses identical query embeddings within the process', async () => {
    const embed = vi.fn().mockResolvedValue({
      embeddings: [[1, 0, 0]],
      model: 'embedding-model',
      usage: { tokensIn: 1 },
    });

    const retriever = new HybridRetriever({
      vector: makeRetriever(),
      fts: makeRetriever(),
      llm: {
        name: 'stub',
        chat: vi.fn(),
        chatStream: vi.fn(),
        structured: vi.fn(),
        embed,
      },
      log: makeLog() as never,
      embeddingModel: 'gemini-embedding-001',
    });

    await retriever.search({ phoneId: 'phone-a', query: 'camera battery' });
    await retriever.search({ phoneId: 'phone-b', query: 'camera battery' });

    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('does not share an embedding cache entry across different providers', async () => {
    const embedA = vi
      .fn()
      .mockResolvedValue({ embeddings: [[1, 0]], model: 'a', usage: { tokensIn: 1 } });
    const embedB = vi
      .fn()
      .mockResolvedValue({ embeddings: [[0, 1]], model: 'b', usage: { tokensIn: 1 } });
    const create = (name: string, embed: typeof embedA) =>
      new HybridRetriever({
        vector: makeRetriever(),
        fts: makeRetriever(),
        llm: { name, chat: vi.fn(), chatStream: vi.fn(), structured: vi.fn(), embed },
        log: makeLog() as never,
        embeddingModel: 'same-model',
      });
    await create('stub', embedA).search({ phoneId: 'p', query: 'battery' });
    await create('live', embedB).search({ phoneId: 'p', query: 'battery' });
    expect(embedA).toHaveBeenCalledTimes(1);
    expect(embedB).toHaveBeenCalledTimes(1);
  });

  it('reports a degraded vector stage rather than hiding the failure in timing', async () => {
    const retriever = new HybridRetriever({
      vector: {
        name: 'vector',
        search: vi.fn().mockRejectedValue(new Error('database vector unavailable')),
      },
      fts: makeRetriever(),
      llm: {
        name: 'stub',
        chat: vi.fn(),
        chatStream: vi.fn(),
        structured: vi.fn(),
        embed: vi
          .fn()
          .mockResolvedValue({ embeddings: [[1, 0]], model: 'stub', usage: { tokensIn: 0 } }),
      },
      log: makeLog() as never,
    });
    const result = await retriever.search({ phoneId: 'p', query: 'battery' });
    expect(result.debug.vector.error).toContain('database vector unavailable');
    expect(result.debug.embedding?.ms).toBeGreaterThanOrEqual(0);
  });
});

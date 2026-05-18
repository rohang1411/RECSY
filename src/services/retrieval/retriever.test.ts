/**
 * Unit tests for the hybrid retriever orchestration.
 *
 * The scorecard pipeline repeats the same seven aspect queries across many
 * phones, so query embeddings must be cached within a run to avoid burning
 * Gemini request budget on identical query text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HybridRetriever, resetHybridRetrieverQueryEmbeddingCache } from './retriever';
import type { Retriever } from './types';

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
});

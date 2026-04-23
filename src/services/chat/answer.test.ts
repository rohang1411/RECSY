import { describe, expect, it, vi } from 'vitest';

import type { LlmProvider } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { RetrievalResult } from '@/services/retrieval/types';

import { NO_CONTEXT_MODEL, runPhoneQna } from './answer';

function emptyRetrieval(phoneId: string, query: string): RetrievalResult {
  return {
    chunks: [],
    debug: {
      phoneId,
      query,
      vector: { count: 0, ms: 0 },
      fts: { count: 0, ms: 0 },
      rrf: { count: 0, ms: 0 },
      mmr: { count: 0, ms: 0 },
      coverage: { sourceCount: 0, relaxed: false },
      totalMs: 0,
    },
  };
}

function stubLog() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => stubLog()),
  } as unknown as Parameters<typeof runPhoneQna>[0]['log'];
}

describe('runPhoneQna zero-chunk short-circuit', () => {
  it('skips the LLM entirely and returns the no-context marker when retrieval is empty', async () => {
    const retriever: HybridRetriever = {
      search: vi.fn(async (req) => emptyRetrieval(req.phoneId, req.query)),
    } as unknown as HybridRetriever;

    const llm: LlmProvider = {
      chat: vi.fn(),
      embed: vi.fn(),
    } as unknown as LlmProvider;

    const res = await runPhoneQna({
      phoneId: '00000000-0000-0000-0000-000000000001',
      query: 'How is the camera according to the reviews?',
      retriever,
      llm,
      log: stubLog(),
    });

    expect(res.model).toBe(NO_CONTEXT_MODEL);
    expect(res.citations).toEqual([]);
    expect(res.usage).toEqual({ tokensIn: 0, tokensOut: 0 });
    expect(res.text.length).toBeGreaterThan(0);
    expect(res.text).toMatch(/no review sources ingested/i);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

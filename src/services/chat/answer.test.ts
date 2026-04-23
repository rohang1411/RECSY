import { describe, expect, it, vi } from 'vitest';

import type { LlmProvider } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { RetrievalResult } from '@/services/retrieval/types';

import { NO_CONTEXT_MODEL, buildNoContextMessage, runPhoneQna } from './answer';

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
    expect(res.text).toMatch(/haven't collected reviews/i);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe('buildNoContextMessage', () => {
  it('falls back to generic copy without metadata', () => {
    const msg = buildNoContextMessage(undefined);
    expect(msg).toMatch(/haven't collected reviews/i);
  });

  it('names the phone and mentions days-since-last-ingest', () => {
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    const msg = buildNoContextMessage({
      brand: 'Google',
      model: 'Pixel 9 Pro',
      lastIngestAt: fourDaysAgo,
      nextIngestAt: null,
    });
    expect(msg).toContain('Google Pixel 9 Pro');
    expect(msg).toMatch(/4 days ago/);
  });

  it('says "scheduled in about Nh" when next refresh < 48h', () => {
    const in12h = new Date(Date.now() + 12 * 60 * 60 * 1000);
    const msg = buildNoContextMessage({
      brand: 'Apple',
      model: 'iPhone 17',
      lastIngestAt: null,
      nextIngestAt: in12h,
    });
    expect(msg).toMatch(/about 12h/);
  });

  it('falls back to "days" when next refresh > 48h', () => {
    const in4d = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    const msg = buildNoContextMessage({
      brand: null,
      model: null,
      lastIngestAt: null,
      nextIngestAt: in4d,
    });
    expect(msg).toMatch(/about 4 days/);
  });
});

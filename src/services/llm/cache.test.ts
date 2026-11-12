/**
 * Unit tests for the LLM response cache (`cache.ts`).
 *
 * Tests cover: cache miss delegates to inner provider, cache hit returns
 * cached result with `cached: true`, `chatStream` always bypasses the cache,
 * `embed` always bypasses the cache, schema revalidation rejects a cached
 * result that no longer matches the schema, and the `enabled=false` path
 * bypasses all caching logic.
 *
 * DB is mocked via `vi.mock` — no real Postgres connections.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { ChatResult, LlmProvider, StructuredResult } from './types';

// Mock DB before importing cache.ts
const mockSelect = vi.fn();
const mockInsert = vi.fn();
vi.mock('@/services/db/client', () => ({
  getDb: () => ({
    select: mockSelect,
    insert: mockInsert,
  }),
}));

const { CachedLlmProvider, buildCacheKey } = await import('./cache');

const mockUsage = { tokensIn: 10, tokensOut: 20 };

function makeInner(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    name: 'test-inner',
    chat: vi.fn().mockResolvedValue({
      text: 'hello',
      cached: false,
      usage: mockUsage,
      model: 'gemini-flash',
    } satisfies ChatResult),
    chatStream: vi.fn().mockReturnValue(
      (async function* () {
        yield { type: 'text-delta', textDelta: 'hi' };
      })(),
    ),
    structured: vi.fn().mockResolvedValue({
      value: { score: 7 },
      cached: false,
      usage: mockUsage,
      model: 'gemini-flash',
      attempts: 1,
    } satisfies StructuredResult<unknown>),
    embed: vi.fn().mockResolvedValue({
      embeddings: [[0.1, 0.2]],
      model: 'gemini-embed',
      usage: { tokensIn: 5 },
    }),
    ...overrides,
  };
}

function makeDbMiss() {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  };
  mockSelect.mockReturnValue(chain);
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
  mockInsert.mockReturnValue(insertChain);
}

function makeDbHit(response: unknown, createdAt = new Date()) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([{ response, createdAt }]),
  };
  mockSelect.mockReturnValue(chain);
}

describe('CachedLlmProvider — chat', () => {
  it('delegates to inner on cache miss and returns result', async () => {
    makeDbMiss();
    const inner = makeInner();
    const provider = new CachedLlmProvider(inner, true);
    const result = await provider.chat({
      model: 'gemini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(inner.chat).toHaveBeenCalledOnce();
    expect(result.text).toBe('hello');
  });

  it('returns cached result with cached=true on hit', async () => {
    makeDbHit({ text: 'cached-text', cached: false, usage: mockUsage, model: 'gemini-flash' });
    const inner = makeInner();
    const provider = new CachedLlmProvider(inner, true);
    const result = await provider.chat({
      model: 'gemini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(inner.chat).not.toHaveBeenCalled();
    expect(result.cached).toBe(true);
    expect(result.text).toBe('cached-text');
  });

  it('bypasses cache entirely when enabled=false', async () => {
    const inner = makeInner();
    const provider = new CachedLlmProvider(inner, false);
    const result = await provider.chat({
      model: 'gemini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(inner.chat).toHaveBeenCalledOnce();
    expect(result.cached).toBe(false);
  });
});

describe('CachedLlmProvider — chatStream bypasses cache', () => {
  it('always delegates streaming to inner', () => {
    const inner = makeInner();
    const provider = new CachedLlmProvider(inner, true);
    provider.chatStream({ model: 'gemini', messages: [] });
    expect(inner.chatStream).toHaveBeenCalledOnce();
  });
});

describe('CachedLlmProvider — embed bypasses cache', () => {
  it('always delegates embed to inner', async () => {
    const inner = makeInner();
    const provider = new CachedLlmProvider(inner, true);
    await provider.embed(['text1', 'text2']);
    expect(inner.embed).toHaveBeenCalledOnce();
  });
});

describe('CachedLlmProvider — structured schema revalidation', () => {
  it('refetches when cached value fails the current schema', async () => {
    const schema = z.object({ score: z.number().max(10) });
    // Cached value has score=999, which fails the new schema
    makeDbHit({
      value: { score: 999 },
      cached: false,
      usage: mockUsage,
      model: 'gemini-flash',
      attempts: 1,
    });
    // Inner returns a valid result after the miss
    const inner = makeInner({
      structured: vi.fn().mockResolvedValue({
        value: { score: 5 },
        cached: false,
        usage: mockUsage,
        model: 'gemini-flash',
        attempts: 1,
      }),
    });
    // Set up insert for the write-back
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };
    mockInsert.mockReturnValue(insertChain);

    const provider = new CachedLlmProvider(inner, true);
    const result = await provider.structured({
      model: 'gemini',
      messages: [],
      schema,
      schemaName: 'test',
    });
    expect(inner.structured).toHaveBeenCalledOnce();
    expect((result.value as { score: number }).score).toBe(5);
  });

  it('treats cached entry as miss if older than 30 days', async () => {
    const expiredDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    makeDbHit({ text: 'old', cached: false, usage: mockUsage, model: 'gemini-flash' }, expiredDate);
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    };
    mockInsert.mockReturnValue(insertChain);

    const inner = makeInner();
    const provider = new CachedLlmProvider(inner, true);
    const result = await provider.chat({
      model: 'gemini',
      messages: [{ role: 'user', content: 'test-expired' }],
    });
    expect(inner.chat).toHaveBeenCalledOnce();
    expect(result.cached).toBe(false);
  });

  it('coalesces concurrent requests with identical prompts into a single call', async () => {
    makeDbMiss();
    let resolveInner: ((val: ChatResult) => void) | undefined;
    const innerPromise = new Promise<ChatResult>((resolve) => {
      resolveInner = resolve;
    });

    const inner = makeInner({
      chat: vi.fn().mockImplementation(() => innerPromise),
    });
    const provider = new CachedLlmProvider(inner, true);

    const call1 = provider.chat({
      model: 'gemini',
      messages: [{ role: 'user', content: 'coalesce-test' }],
    });
    const call2 = provider.chat({
      model: 'gemini',
      messages: [{ role: 'user', content: 'coalesce-test' }],
    });

    resolveInner!({
      text: 'coalesced-response',
      cached: false,
      usage: mockUsage,
      model: 'gemini-flash',
    });

    const [res1, res2] = await Promise.all([call1, call2]);
    expect(inner.chat).toHaveBeenCalledOnce();
    expect(res1.text).toBe('coalesced-response');
    expect(res2.text).toBe('coalesced-response');
  });

  describe('Cache Key Correctness (Plan 26 WP-10)', () => {
    it('produces different keys for fast vs deep userMode with same prompt', () => {
      const base = {
        model: 'gemini',
        messages: [{ role: 'user' as const, content: 'tell me about phone X' }],
      };

      const keyFast = buildCacheKey({
        ...base,
        usageContext: { area: 'chat', userMode: 'fast' },
      });

      const keyDeep = buildCacheKey({
        ...base,
        usageContext: { area: 'chat', userMode: 'deep' },
      });

      expect(keyFast).not.toBe(keyDeep);
    });

    it('produces different keys for different taskClass and thinking settings', () => {
      const base = {
        model: 'gemini',
        messages: [{ role: 'user' as const, content: 'tell me about phone X' }],
      };

      const keyExtraction = buildCacheKey({ ...base, taskClass: 'EXTRACTION' });
      const keySynthesis = buildCacheKey({ ...base, taskClass: 'GROUNDED_SYNTHESIS' });
      expect(keyExtraction).not.toBe(keySynthesis);

      const keyMinimalThinking = buildCacheKey({ ...base, thinking: 'minimal' });
      const keyDefaultThinking = buildCacheKey({ ...base, thinking: 'default' });
      expect(keyMinimalThinking).not.toBe(keyDefaultThinking);
    });

    it('includes byok provider name in key but never the secret API key', () => {
      const base = {
        model: 'gemini',
        messages: [{ role: 'user' as const, content: 'hello' }],
      };

      const keyGroq = buildCacheKey({
        ...base,
        usageContext: {
          area: 'chat',
          userByokProvider: 'groq',
          userByokKey: 'super-secret-key-1',
        },
      });

      const keyGemini = buildCacheKey({
        ...base,
        usageContext: {
          area: 'chat',
          userByokProvider: 'gemini',
          userByokKey: 'super-secret-key-1',
        },
      });

      const keyGroqKey2 = buildCacheKey({
        ...base,
        usageContext: {
          area: 'chat',
          userByokProvider: 'groq',
          userByokKey: 'different-secret-key-2',
        },
      });

      // Different BYOK providers have different cache keys
      expect(keyGroq).not.toBe(keyGemini);
      // Same BYOK provider with different user key shares cache key (API key not in hash)
      expect(keyGroq).toBe(keyGroqKey2);
    });
  });

  describe('lookupChat and storeChat (Plan 26 WP-06 / WP-10)', () => {
    it('returns null on cache miss and cached result on hit', async () => {
      makeDbMiss();
      const inner = makeInner();
      const provider = new CachedLlmProvider(inner, true);

      const miss = await provider.lookupChat({
        model: 'gemini',
        messages: [{ role: 'user', content: 'test-lookup' }],
      });
      expect(miss).toBeNull();

      makeDbHit({ text: 'stored-result', cached: false, usage: mockUsage, model: 'gemini' });
      const hit = await provider.lookupChat({
        model: 'gemini',
        messages: [{ role: 'user', content: 'test-lookup' }],
      });
      expect(hit).not.toBeNull();
      expect(hit?.text).toBe('stored-result');
      expect(hit?.cached).toBe(true);
    });

    it('stores chat result asynchronously via deferOrRun without throwing', () => {
      const insertChain = {
        values: vi.fn().mockReturnThis(),
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      };
      mockInsert.mockReturnValue(insertChain);

      const inner = makeInner();
      const provider = new CachedLlmProvider(inner, true);

      expect(() => {
        provider.storeChat(
          { model: 'gemini', messages: [{ role: 'user', content: 'test-store' }] },
          { text: 'result-to-store', cached: false, usage: mockUsage, model: 'gemini' },
        );
      }).not.toThrow();
    });
  });
});

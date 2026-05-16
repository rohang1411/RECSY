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
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
vi.mock('@/services/db/client', () => ({
  getDb: () => ({
    update: mockUpdate,
    insert: mockInsert,
  }),
}));

const { CachedLlmProvider } = await import('./cache');

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
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
  mockUpdate.mockReturnValue(chain);
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
  mockInsert.mockReturnValue(insertChain);
}

function makeDbHit(response: unknown) {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ response }]),
  };
  mockUpdate.mockReturnValue(chain);
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
});

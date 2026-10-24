import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import { LlmTimeoutError } from '@/lib/errors';
import type { ChatDelta, ChatInput, ChatResult } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { RetrievalResult, RetrievedChunk } from '@/services/retrieval/types';

import { NO_CONTEXT_MODEL, type PhoneQnaResult } from './answer';
import { runPhoneQnaStream, ASK_STREAM_DEADLINES, type QnaStreamEvent } from './answer-stream';
import type { ResolvedCitation } from './citations';

const dummyLogger = pino({ level: 'silent' });

function createMockChunk(id: string): RetrievedChunk {
  return {
    chunkId: id,
    sourceId: `src-${id}`,
    text: `Excerpt for chunk ${id}`,
    source: {
      id: `src-${id}`,
      type: 'article',
      title: `Source for ${id}`,
      url: `https://example.com/source-${id}`,
      author: 'Test Author',
      channel: null,
      publishedAt: new Date(),
    },
    anchor: null,
    startTs: null,
    score: 0.9,
  };
}

function createMockRetriever(chunks: RetrievedChunk[]): HybridRetriever {
  return {
    search: vi.fn().mockResolvedValue({
      chunks,
      debug: {
        totalMs: 10,
        fts: { ms: 5 },
        vector: { ms: 5 },
      },
    } as unknown as RetrievalResult),
  } as unknown as HybridRetriever;
}

describe('runPhoneQnaStream', () => {
  it('handles empty corpus / no-context short-circuit', async () => {
    const retriever = createMockRetriever([]);
    const llm = {
      name: 'test-llm',
      chat: vi.fn(),
      chatStream: vi.fn(),
      structured: vi.fn(),
    };

    const stages: string[] = [];
    const events: QnaStreamEvent[] = [];
    for await (const ev of runPhoneQnaStream({
      phoneId: 'p-1',
      query: 'how is the battery?',
      retriever,
      llm,
      log: dummyLogger,
      onStage: (st) => stages.push(st),
    })) {
      events.push(ev);
    }

    expect(stages).toEqual(['retrieving']);
    expect(llm.chatStream).not.toHaveBeenCalled();

    const statusEv = events.find((e) => e.type === 'status');
    expect(statusEv).toEqual({ type: 'status', stage: 'retrieving' });

    const metaEv = events.find((e) => e.type === 'meta');
    expect(metaEv).toEqual({ type: 'meta', phoneId: 'p-1', retrievedChunkIds: [] });

    const finalEv = events.find((e) => e.type === 'final');
    expect(finalEv).toBeDefined();
    if (finalEv && finalEv.type === 'final') {
      expect(finalEv.result.model).toBe(NO_CONTEXT_MODEL);
      expect(finalEv.result.citations).toEqual([]);
      expect(finalEv.result.streamed).toBe(true);
    }
  });

  it('serves from cache on lookupChat hit without invoking chatStream', async () => {
    const chunkId = '00000000-0000-0000-0000-000000000001';
    const retriever = createMockRetriever([createMockChunk(chunkId)]);

    const cachedText = `Great battery life! [c:${chunkId}]`;
    const lookupChat = vi.fn().mockResolvedValue({
      text: cachedText,
      usage: { tokensIn: 10, tokensOut: 20 },
      model: 'cached-model',
      cached: true,
    } as ChatResult);

    const llm = {
      name: 'test-llm',
      chat: vi.fn(),
      chatStream: vi.fn(),
      lookupChat,
      structured: vi.fn(),
    };

    const stages: string[] = [];
    const deltas: string[] = [];
    const citations: ResolvedCitation[] = [];
    let finalResult: (PhoneQnaResult & { streamed: true; citationRepairs: number }) | null = null;

    for await (const ev of runPhoneQnaStream({
      phoneId: 'p-1',
      query: 'battery?',
      retriever,
      llm,
      log: dummyLogger,
      onStage: (st) => stages.push(st),
    })) {
      if (ev.type === 'delta') deltas.push(ev.text);
      if (ev.type === 'citation') citations.push(ev.citation);
      if (ev.type === 'final') finalResult = ev.result;
    }

    expect(stages).toEqual(['retrieving', 'generating']);
    expect(lookupChat).toHaveBeenCalledTimes(1);
    expect(llm.chatStream).not.toHaveBeenCalled();

    expect(deltas.join('')).toBe(cachedText);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.chunkId).toBe(chunkId);
    expect(finalResult?.generationAccounting.cacheHits).toBe(1);
    expect(finalResult?.generationAccounting.providerCalls).toBe(0);
    expect(finalResult?.streamed).toBe(true);
    expect(finalResult?.citationRepairs).toBe(0);
  });

  it('streams deltas on cache miss and emits citations progressively', async () => {
    const chunkId1 = '00000000-0000-0000-0000-000000000001';
    const chunkId2 = '00000000-0000-0000-0000-000000000002';
    const retriever = createMockRetriever([createMockChunk(chunkId1), createMockChunk(chunkId2)]);

    async function* fakeStream(): AsyncIterable<ChatDelta> {
      yield { type: 'text-delta', textDelta: 'Fast charging is supported ' };
      yield { type: 'text-delta', textDelta: `[c:${chunkId1}]. ` };
      yield { type: 'text-delta', textDelta: 'Camera is sharp ' };
      yield { type: 'text-delta', textDelta: `[c:${chunkId2}].` };
      yield {
        type: 'finish',
        usage: { tokensIn: 50, tokensOut: 30 },
        model: 'gemini-test',
      };
    }

    const storeChat = vi.fn();
    const llm = {
      name: 'test-llm',
      chat: vi.fn(),
      chatStream: vi.fn().mockImplementation(() => fakeStream()),
      lookupChat: vi.fn().mockResolvedValue(null),
      storeChat,
      structured: vi.fn(),
    };

    const deltas: string[] = [];
    const citations: ResolvedCitation[] = [];
    let finalResult: (PhoneQnaResult & { streamed: true; citationRepairs: number }) | null = null;

    for await (const ev of runPhoneQnaStream({
      phoneId: 'p-1',
      query: 'specs?',
      retriever,
      llm,
      log: dummyLogger,
    })) {
      if (ev.type === 'delta') deltas.push(ev.text);
      if (ev.type === 'citation') citations.push(ev.citation);
      if (ev.type === 'final') finalResult = ev.result;
    }

    expect(deltas.join('')).toBe(
      `Fast charging is supported [c:${chunkId1}]. Camera is sharp [c:${chunkId2}].`,
    );
    expect(citations).toHaveLength(2);
    expect(citations[0]?.chunkId).toBe(chunkId1);
    expect(citations[1]?.chunkId).toBe(chunkId2);
    expect(finalResult?.generationAccounting.providerCalls).toBe(1);
    expect(finalResult?.citationRepairs).toBe(0);
    expect(storeChat).toHaveBeenCalledTimes(1);
  });

  it('strips invalid citation tags, records citationRepairs, and does not cache repaired answer', async () => {
    const validChunk = '00000000-0000-0000-0000-000000000001';
    const invalidChunk = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const retriever = createMockRetriever([createMockChunk(validChunk)]);

    async function* fakeStream(): AsyncIterable<ChatDelta> {
      yield { type: 'text-delta', textDelta: `Good screen [c:${validChunk}] and battery ` };
      yield { type: 'text-delta', textDelta: `[c:${invalidChunk}] life.` };
      yield {
        type: 'finish',
        usage: { tokensIn: 40, tokensOut: 20 },
        model: 'gemini-test',
      };
    }

    const storeChat = vi.fn();
    const llm = {
      name: 'test-llm',
      chat: vi.fn(),
      chatStream: vi.fn().mockImplementation(() => fakeStream()),
      lookupChat: vi.fn().mockResolvedValue(null),
      storeChat,
      structured: vi.fn(),
    };

    const deltas: string[] = [];
    const citations: ResolvedCitation[] = [];
    let finalResult: (PhoneQnaResult & { streamed: true; citationRepairs: number }) | null = null;

    for await (const ev of runPhoneQnaStream({
      phoneId: 'p-1',
      query: 'battery?',
      retriever,
      llm,
      log: dummyLogger,
    })) {
      if (ev.type === 'delta') deltas.push(ev.text);
      if (ev.type === 'citation') citations.push(ev.citation);
      if (ev.type === 'final') finalResult = ev.result;
    }

    expect(deltas.join('')).toBe(`Good screen [c:${validChunk}] and battery life.`);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.chunkId).toBe(validChunk);
    expect(finalResult?.citationRepairs).toBe(1);
    // Crucial rule: never cache repaired answer
    expect(storeChat).not.toHaveBeenCalled();
  });

  it('stops without final if signal is aborted mid-stream', async () => {
    const chunkId = '00000000-0000-0000-0000-000000000001';
    const retriever = createMockRetriever([createMockChunk(chunkId)]);

    const controller = new AbortController();

    async function* fakeStream(): AsyncIterable<ChatDelta> {
      yield { type: 'text-delta', textDelta: 'First word ' };
      controller.abort();
      yield { type: 'text-delta', textDelta: 'Second word' };
    }

    const llm = {
      name: 'test-llm',
      chat: vi.fn(),
      chatStream: vi.fn().mockImplementation(() => fakeStream()),
      lookupChat: vi.fn().mockResolvedValue(null),
      structured: vi.fn(),
    };

    const events: QnaStreamEvent[] = [];
    for await (const ev of runPhoneQnaStream({
      phoneId: 'p-1',
      query: 'test?',
      retriever,
      llm,
      log: dummyLogger,
      signal: controller.signal,
    })) {
      events.push(ev);
    }

    const finalEv = events.find((e) => e.type === 'final');
    expect(finalEv).toBeUndefined();
  });

  it('throws LlmTimeoutError when first-delta deadline is exceeded', async () => {
    vi.useFakeTimers();
    try {
      const chunkId = '00000000-0000-0000-0000-000000000001';
      const retriever = createMockRetriever([createMockChunk(chunkId)]);

      async function* hangingStream(signal?: AbortSignal): AsyncIterable<ChatDelta> {
        await new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        });
      }

      const llm = {
        name: 'test-llm',
        chat: vi.fn(),
        chatStream: vi.fn().mockImplementation((input: ChatInput) => hangingStream(input.signal)),
        lookupChat: vi.fn().mockResolvedValue(null),
        structured: vi.fn(),
      };

      const streamGen = runPhoneQnaStream({
        phoneId: 'p-1',
        query: 'test?',
        retriever,
        llm,
        log: dummyLogger,
      });

      const iteratePromise = (async () => {
        for await (const _ev of streamGen) {
          // consume
        }
      })();

      const assertion = expect(iteratePromise).rejects.toThrow(LlmTimeoutError);
      await vi.advanceTimersByTimeAsync(ASK_STREAM_DEADLINES.firstDeltaFastMs + 100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('throws LlmTimeoutError when idle deadline between deltas is exceeded', async () => {
    vi.useFakeTimers();
    try {
      const chunkId = '00000000-0000-0000-0000-000000000001';
      const retriever = createMockRetriever([createMockChunk(chunkId)]);

      async function* stallingStream(signal?: AbortSignal): AsyncIterable<ChatDelta> {
        yield { type: 'text-delta', textDelta: 'Initial words ' };
        await new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        });
        yield { type: 'text-delta', textDelta: 'Stalled words' };
      }

      const llm = {
        name: 'test-llm',
        chat: vi.fn(),
        chatStream: vi.fn().mockImplementation((input: ChatInput) => stallingStream(input.signal)),
        lookupChat: vi.fn().mockResolvedValue(null),
        structured: vi.fn(),
      };

      const streamGen = runPhoneQnaStream({
        phoneId: 'p-1',
        query: 'test?',
        retriever,
        llm,
        log: dummyLogger,
      });

      const iteratePromise = (async () => {
        for await (const _ev of streamGen) {
          // consume
        }
      })();

      const assertion = expect(iteratePromise).rejects.toThrow(LlmTimeoutError);
      // Yield initial words
      await vi.advanceTimersByTimeAsync(50);
      // Advance past idle deadline
      await vi.advanceTimersByTimeAsync(ASK_STREAM_DEADLINES.idleBetweenDeltasMs + 100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

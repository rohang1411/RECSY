import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CascadeExecutor } from './cascade-executor';
import { GeminiProvider } from '../gemini';
import { KeyPoolRegistry, type ProviderKeyEntry } from '../keys/key-pool';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { MultiProviderQuotaGovernor } from './quota-governor';
import { LlmError } from '@/lib/errors';
import type { ModelCandidate } from './task-profiles';
import type { ModelAdapter } from '../adapters/base-adapter';

function getAdapter(executor: CascadeExecutor, name: string): ModelAdapter {
  const map = (executor as unknown as { openAiAdapters: Map<string, ModelAdapter> }).openAiAdapters;
  const adapter = map.get(name);
  if (!adapter) throw new Error(`Adapter ${name} not found`);
  return adapter;
}

describe('CascadeExecutor - Streaming Failover Semantics (Plan 26 WP-10)', () => {
  let geminiProvider: GeminiProvider;
  let keyPool: KeyPoolRegistry;
  let circuitBreakers: CircuitBreakerRegistry;
  let quotaGovernor: MultiProviderQuotaGovernor;
  let executor: CascadeExecutor;

  const mockGroqKeys: readonly ProviderKeyEntry[] = [
    {
      id: 'groq-1',
      providerId: 'groq',
      apiKey: 'gsk_12345678',
      keyIndex: 0,
      rpmLimit: 30,
      rpdLimit: 14400,
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    geminiProvider = new GeminiProvider({ recordUsage: false });
    keyPool = new KeyPoolRegistry();
    circuitBreakers = new CircuitBreakerRegistry();
    quotaGovernor = new MultiProviderQuotaGovernor();
    executor = new CascadeExecutor(geminiProvider, keyPool, circuitBreakers, quotaGovernor);
  });

  it('acquires pacing and records success and tokens on completed stream', async () => {
    const acquireSpy = vi.spyOn(quotaGovernor, 'acquire').mockResolvedValue(true);
    const recordMeasuredSpy = vi.spyOn(quotaGovernor, 'recordMeasured');
    vi.spyOn(keyPool, 'getKeysForProvider').mockReturnValue(mockGroqKeys);

    const adapter = getAdapter(executor, 'groq');
    vi.spyOn(adapter, 'chatStream').mockImplementation(async function* () {
      yield { type: 'text-delta', textDelta: 'chunk 1' };
      yield {
        type: 'finish',
        usage: { tokensIn: 100, tokensOut: 50 },
        model: 'llama-3.1-8b-instant',
      };
    });

    const candidates: ModelCandidate[] = [
      { providerId: 'groq', model: 'llama-3.1-8b-instant', maxTokens: 4096, contextWindow: 8192 },
    ];

    const deltas: string[] = [];
    for await (const delta of executor.executeStream(
      { model: 'default', messages: [] },
      candidates,
    )) {
      if (delta.type === 'text-delta' && delta.textDelta) {
        deltas.push(delta.textDelta);
      }
    }

    expect(deltas).toEqual(['chunk 1']);
    expect(acquireSpy).toHaveBeenCalledWith('groq', 0, 1000);
    expect(recordMeasuredSpy).toHaveBeenCalledWith('groq', 0, 100);

    const breaker = circuitBreakers.getBreaker('groq:llama-3.1-8b-instant');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('fails over to next candidate when error occurs before first delta', async () => {
    vi.spyOn(keyPool, 'getKeysForProvider').mockReturnValue(mockGroqKeys);
    const adapter = getAdapter(executor, 'groq');
    // First candidate throws immediately before yielding anything
    vi.spyOn(adapter, 'chatStream').mockImplementation(async function* () {
      throw new LlmError('Groq network failure', { status: 500 });
    });

    // Gemini fallback yields successfully
    const geminiStreamSpy = vi
      .spyOn(geminiProvider, 'chatStream')
      .mockImplementation(async function* () {
        yield { type: 'text-delta', textDelta: 'gemini fallback text' };
        yield {
          type: 'finish',
          usage: { tokensIn: 50, tokensOut: 20 },
          model: 'gemini-3-flash-preview',
        };
      });

    const candidates: ModelCandidate[] = [
      { providerId: 'groq', model: 'llama-3.1-8b-instant', maxTokens: 4096, contextWindow: 8192 },
      {
        providerId: 'gemini',
        model: 'gemini-3-flash-preview',
        maxTokens: 8192,
        contextWindow: 32768,
      },
    ];

    const deltas: string[] = [];
    for await (const delta of executor.executeStream(
      { model: 'default', messages: [] },
      candidates,
    )) {
      if (delta.type === 'text-delta' && delta.textDelta) {
        deltas.push(delta.textDelta);
      }
    }

    expect(deltas).toEqual(['gemini fallback text']);
    expect(geminiStreamSpy).toHaveBeenCalledOnce();

    // Groq circuit breaker recorded the failure
    const groqBreaker = circuitBreakers.getBreaker('groq:llama-3.1-8b-instant');
    expect(groqBreaker.canAttempt()).toBe(true);
  });

  it('rethrows immediately and NEVER fails over if an error happens after first delta', async () => {
    vi.spyOn(keyPool, 'getKeysForProvider').mockReturnValue(mockGroqKeys);
    const adapter = getAdapter(executor, 'groq');
    // Yields one chunk, then throws
    vi.spyOn(adapter, 'chatStream').mockImplementation(async function* () {
      yield { type: 'text-delta', textDelta: 'partial start' };
      throw new LlmError('Mid-stream TCP reset', { status: 500 });
    });

    const geminiStreamSpy = vi.spyOn(geminiProvider, 'chatStream');

    const candidates: ModelCandidate[] = [
      { providerId: 'groq', model: 'llama-3.1-8b-instant', maxTokens: 4096, contextWindow: 8192 },
      {
        providerId: 'gemini',
        model: 'gemini-3-flash-preview',
        maxTokens: 8192,
        contextWindow: 32768,
      },
    ];

    const deltas: string[] = [];
    let caughtError: unknown = null;

    try {
      for await (const delta of executor.executeStream(
        { model: 'default', messages: [] },
        candidates,
      )) {
        if (delta.type === 'text-delta' && delta.textDelta) {
          deltas.push(delta.textDelta);
        }
      }
    } catch (err) {
      caughtError = err;
    }

    // Client received the partial chunk before error
    expect(deltas).toEqual(['partial start']);
    expect(caughtError).toBeInstanceOf(LlmError);

    // CRITICAL: Gemini fallback must NOT have been called (no duplicate text stream)
    expect(geminiStreamSpy).not.toHaveBeenCalled();
  });
});

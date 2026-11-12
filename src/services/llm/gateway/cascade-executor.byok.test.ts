import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CascadeExecutor } from './cascade-executor';
import { GeminiProvider } from '../gemini';
import { KeyPoolRegistry } from '../keys/key-pool';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { MultiProviderQuotaGovernor } from './quota-governor';
import { ByokError } from '@/lib/errors';
import type { ModelCandidate } from './task-profiles';
import type { ModelAdapter } from '../adapters/base-adapter';
import type { ByokProviderId } from '../keys/byok-parser';
import type { ChatDelta } from '../types';
import { z } from 'zod';

function getAdapter(executor: CascadeExecutor, name: string): ModelAdapter {
  const map = (executor as unknown as { openAiAdapters: Map<string, ModelAdapter> }).openAiAdapters;
  const adapter = map.get(name);
  if (!adapter) throw new Error(`Adapter ${name} not found`);
  return adapter;
}

describe('CascadeExecutor - BYOK Isolation and Error Mapping', () => {
  let geminiProvider: GeminiProvider;
  let keyPool: KeyPoolRegistry;
  let circuitBreakers: CircuitBreakerRegistry;
  let quotaGovernor: MultiProviderQuotaGovernor;
  let executor: CascadeExecutor;

  const platformCandidates: ModelCandidate[] = [
    { providerId: 'gemini', model: 'gemini-2.5-flash', maxTokens: 8192, contextWindow: 32768 },
    { providerId: 'groq', model: 'llama-3.1-8b-instant', maxTokens: 4096, contextWindow: 8192 },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    geminiProvider = new GeminiProvider();
    keyPool = new KeyPoolRegistry();
    circuitBreakers = new CircuitBreakerRegistry();
    quotaGovernor = new MultiProviderQuotaGovernor();
    executor = new CascadeExecutor(geminiProvider, keyPool, circuitBreakers, quotaGovernor);
  });

  describe('executeChat with BYOK', () => {
    it('uses GeminiProvider.withKey and never touches platform key pool or platform gemini provider', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      const platformChatSpy = vi.spyOn(geminiProvider, 'chat');

      const mockWithKeyInstance = {
        chat: vi.fn().mockResolvedValue({
          text: 'Response from user Gemini key',
          usage: { tokensIn: 10, tokensOut: 20 },
          model: 'gemini-2.5-flash',
          cached: false,
        }),
      } as unknown as GeminiProvider;

      const withKeySpy = vi.spyOn(GeminiProvider, 'withKey').mockReturnValue(mockWithKeyInstance);

      const result = await executor.executeChat(
        {
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: 'hello' }],
        },
        platformCandidates,
        'user-gemini-key-12345678',
        'gemini',
      );

      expect(withKeySpy).toHaveBeenCalledWith('user-gemini-key-12345678');
      expect(mockWithKeyInstance.chat).toHaveBeenCalled();
      expect(getKeysSpy).not.toHaveBeenCalled();
      expect(platformChatSpy).not.toHaveBeenCalled();
      expect(result.text).toBe('Response from user Gemini key');
    });

    it('routes openai BYOK to openai adapter with user key', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      const adapter = getAdapter(executor, 'openai');
      const chatSpy = vi.spyOn(adapter, 'chat').mockResolvedValue({
        text: 'Response from OpenAI BYOK',
        usage: { tokensIn: 15, tokensOut: 25 },
        model: 'gpt-4o-mini',
        cached: false,
      });

      const result = await executor.executeChat(
        {
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: 'hello' }],
        },
        platformCandidates,
        'sk-user-openai-key-12345678',
        'openai',
      );

      expect(chatSpy).toHaveBeenCalledWith(
        expect.anything(),
        'gpt-4o-mini',
        'sk-user-openai-key-12345678',
      );
      expect(getKeysSpy).not.toHaveBeenCalled();
      expect(result.text).toBe('Response from OpenAI BYOK');
    });

    it('throws ByokError BYOK_UNSUPPORTED when provider is unsupported and does NOT fall through to platform', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      const platformChatSpy = vi.spyOn(geminiProvider, 'chat');

      await expect(
        executor.executeChat(
          {
            model: 'some-model',
            messages: [{ role: 'user', content: 'hello' }],
          },
          platformCandidates,
          'user-key-12345678',
          'unsupported-provider' as unknown as ByokProviderId,
        ),
      ).rejects.toThrow(ByokError);

      expect(getKeysSpy).not.toHaveBeenCalled();
      expect(platformChatSpy).not.toHaveBeenCalled();
    });

    it('maps 401 provider error to BYOK_REJECTED and never falls through', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      const adapter = getAdapter(executor, 'groq');
      vi.spyOn(adapter, 'chat').mockRejectedValue({
        status: 401,
        message: 'Invalid API Key',
      });

      await expect(
        executor.executeChat(
          {
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'hello' }],
          },
          platformCandidates,
          'gsk-invalid-key-12345678',
          'groq',
        ),
      ).rejects.toMatchObject({
        code: 'BYOK_REJECTED',
        status: 400,
      });

      expect(getKeysSpy).not.toHaveBeenCalled();
    });

    it('maps 429 provider error to BYOK_RATE_LIMITED and never falls through', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      const adapter = getAdapter(executor, 'groq');
      vi.spyOn(adapter, 'chat').mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      });

      await expect(
        executor.executeChat(
          {
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: 'hello' }],
          },
          platformCandidates,
          'gsk-busy-key-12345678',
          'groq',
        ),
      ).rejects.toMatchObject({
        code: 'BYOK_RATE_LIMITED',
        status: 429,
      });

      expect(getKeysSpy).not.toHaveBeenCalled();
    });
  });

  describe('executeStructured with BYOK', () => {
    it('uses user key directly on adapter and never touches platform keys', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      const adapter = getAdapter(executor, 'nvidia');
      const structuredSpy = vi.spyOn(adapter, 'structured').mockResolvedValue({
        value: { foo: 'bar' },
        usage: { tokensIn: 10, tokensOut: 20 },
        model: 'meta/llama-3.1-8b-instruct',
        cached: false,
        attempts: 1,
      });

      const schema = z.object({ foo: z.string() });
      const result = await executor.executeStructured(
        {
          model: 'meta/llama-3.1-8b-instruct',
          messages: [{ role: 'user', content: 'parse json' }],
          schema,
          schemaName: 'FooSchema',
        },
        platformCandidates,
        'nvapi-user-key-12345678',
        'nvidia',
      );

      expect(structuredSpy).toHaveBeenCalledWith(
        expect.anything(),
        'meta/llama-3.1-8b-instruct',
        'nvapi-user-key-12345678',
      );
      expect(getKeysSpy).not.toHaveBeenCalled();
      expect(result.value).toEqual({ foo: 'bar' });
    });
  });

  describe('executeStream with BYOK', () => {
    it('uses GeminiProvider.withKey for streaming without platform key leakage', async () => {
      const getKeysSpy = vi.spyOn(keyPool, 'getKeysForProvider');
      async function* mockStream(): AsyncIterable<ChatDelta> {
        yield { type: 'text-delta', textDelta: 'chunk 1' };
        yield { type: 'text-delta', textDelta: 'chunk 2' };
      }

      const mockWithKeyInstance = {
        chatStream: vi.fn().mockImplementation(mockStream),
      } as unknown as GeminiProvider;

      vi.spyOn(GeminiProvider, 'withKey').mockReturnValue(mockWithKeyInstance);

      const chunks: string[] = [];
      const stream = executor.executeStream(
        {
          model: 'gemini-2.5-flash',
          messages: [{ role: 'user', content: 'stream please' }],
        },
        platformCandidates,
        'user-gemini-key-12345678',
        'gemini',
      );

      for await (const chunk of stream) {
        if (chunk.textDelta) chunks.push(chunk.textDelta);
      }

      expect(chunks).toEqual(['chunk 1', 'chunk 2']);
      expect(getKeysSpy).not.toHaveBeenCalled();
    });
  });

  describe('executeEmbed with BYOK', () => {
    it('delegates embedding to GeminiProvider.withKey when userByokKey is present', async () => {
      const mockWithKeyInstance = {
        embed: vi.fn().mockResolvedValue({
          embeddings: [[0.1, 0.2, 0.3]],
          usage: { tokensIn: 5 },
          model: 'text-embedding-004',
        }),
      } as unknown as GeminiProvider;

      const withKeySpy = vi.spyOn(GeminiProvider, 'withKey').mockReturnValue(mockWithKeyInstance);

      const result = await executor.executeEmbed(['test sentence'], 'text-embedding-004', {
        area: 'Test',
        feature: 'TestEmbed',
        userByokKey: 'user-gemini-embed-key',
        userByokProvider: 'gemini',
      });

      expect(withKeySpy).toHaveBeenCalledWith('user-gemini-embed-key');
      expect(mockWithKeyInstance.embed).toHaveBeenCalled();
      expect(result.embeddings).toHaveLength(1);
    });
  });
});

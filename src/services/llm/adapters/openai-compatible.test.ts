import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAiCompatibleAdapter } from './openai-compatible';

describe('OpenAiCompatibleAdapter', () => {
  const adapter = new OpenAiCompatibleAdapter({
    providerId: 'test-groq',
    baseUrl: 'https://api.groq.com/openai/v1',
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('performs chat completions successfully and extracts tokens', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Pixel 9 Pro has 16GB RAM.' } }],
      usage: { prompt_tokens: 15, completion_tokens: 8 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const result = await adapter.chat(
      {
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Tell me about Pixel 9 Pro' }],
      },
      'llama-3.1-8b-instant',
      'gsk_test_api_key',
    );

    expect(result.text).toBe('Pixel 9 Pro has 16GB RAM.');
    expect(result.usage).toEqual({ tokensIn: 15, tokensOut: 8 });
    expect(result.model).toBe('llama-3.1-8b-instant');
  });

  it('parses structured output and validates against Zod schema', async () => {
    const mockOutput = '```json\n{"brand": "Samsung", "battery": 5000, }\n```';
    const mockResponse = {
      choices: [{ message: { content: mockOutput } }],
      usage: { prompt_tokens: 30, completion_tokens: 12 },
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const schema = z.object({
      brand: z.string(),
      battery: z.number(),
    });

    const result = await adapter.structured(
      {
        model: 'llama-3.1-8b-instant',
        messages: [{ role: 'user', content: 'Extract spec' }],
        schema,
        schemaName: 'Spec',
      },
      'llama-3.1-8b-instant',
      'gsk_test_api_key',
    );

    expect(result.value).toEqual({ brand: 'Samsung', battery: 5000 });
    expect(result.attempts).toBe(1);
  });

  it('throws LlmError on HTTP 429 with retryable flag', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Rate limit reached', { status: 429 }),
    );

    await expect(
      adapter.chat(
        { model: 'llama-3.1-8b-instant', messages: [{ role: 'user', content: 'hello' }] },
        'llama-3.1-8b-instant',
        'gsk_test_key',
      ),
    ).rejects.toThrow(/Rate limit exceeded \(429\)/);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { ModelGatewayProvider } from './index';
import type { CascadeExecutor } from './cascade-executor';
import type { ChatResult, StructuredResult } from '../types';
import * as usageModule from '../usage';

describe('ModelGatewayProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(usageModule, 'recordLlmUsageEvent').mockResolvedValue();
  });
  it('instantiates successfully as an LlmProvider', () => {
    const gateway = new ModelGatewayProvider();
    expect(gateway.name).toBe('model-gateway-router');
    expect(typeof gateway.chat).toBe('function');
    expect(typeof gateway.structured).toBe('function');
    expect(typeof gateway.embed).toBe('function');
    expect(typeof gateway.chatStream).toBe('function');
  });

  it('routes extraction tasks cleanly with valid schema output', async () => {
    const gateway = new ModelGatewayProvider();

    const mockSchema = z.object({
      brand: z.string(),
      battery: z.number(),
    });

    const mockStructuredResult: StructuredResult<{ brand: string; battery: number }> = {
      value: { brand: 'Google', battery: 5000 },
      usage: { tokensIn: 50, tokensOut: 20 },
      model: 'llama-3.1-8b-instant',
      cached: false,
      attempts: 1,
    };

    const executor = (gateway as unknown as { executor: CascadeExecutor }).executor;
    vi.spyOn(executor, 'executeStructured').mockResolvedValueOnce(mockStructuredResult);

    const result = await gateway.structured({
      model: 'default',
      messages: [{ role: 'user', content: 'Extract phone specs' }],
      schema: mockSchema,
      schemaName: 'TestPhoneSpec',
      taskClass: 'EXTRACTION',
      usageContext: { area: 'Catalog enrichment', feature: 'Spec extraction' },
    });

    expect(result.value).toEqual({ brand: 'Google', battery: 5000 });
    expect(result.attempts).toBe(1);
  });

  it('routes grounded chat answering through cascade executor', async () => {
    const gateway = new ModelGatewayProvider();

    const mockChatResult: ChatResult = {
      text: 'The Pixel 9 has excellent battery life based on review [c:12345678-1234-1234-1234-123456789abc].',
      usage: { tokensIn: 120, tokensOut: 35 },
      model: 'gemini-3-flash-preview',
      cached: false,
    };

    const executor = (gateway as unknown as { executor: CascadeExecutor }).executor;
    vi.spyOn(executor, 'executeChat').mockResolvedValueOnce(mockChatResult);

    const result = await gateway.chat({
      model: 'default',
      messages: [{ role: 'user', content: 'How is the battery?' }],
      taskClass: 'GROUNDED_SYNTHESIS',
      usageContext: { area: 'Phone Q&A', feature: 'Grounded answer' },
    });

    expect(result.text).toContain('The Pixel 9 has excellent battery life');
    expect(result.model).toBe('gemini-3-flash-preview');
  });

  it('configures internal GeminiProvider with recordUsage: false so gateway is the single recorder', () => {
    const gateway = new ModelGatewayProvider();
    const gemini = (gateway as unknown as { geminiProvider: { shouldRecordUsage: boolean } })
      .geminiProvider;
    expect(gemini.shouldRecordUsage).toBe(false);
  });

  it('records exactly one usage event per Gemini-served gateway chat (Plan 26 WP-10)', async () => {
    const usageSpy = vi.spyOn(usageModule, 'recordLlmUsageEvent').mockResolvedValue();

    const gateway = new ModelGatewayProvider();
    const mockChatResult: ChatResult = {
      text: 'Answer from Gemini',
      usage: { tokensIn: 80, tokensOut: 40 },
      model: 'gemini-3-flash-preview',
      cached: false,
    };

    const executor = (gateway as unknown as { executor: CascadeExecutor }).executor;
    vi.spyOn(executor, 'executeChat').mockResolvedValueOnce(mockChatResult);

    await gateway.chat({
      model: 'default',
      messages: [{ role: 'user', content: 'Specs for Pixel' }],
      taskClass: 'GROUNDED_SYNTHESIS',
      usageContext: { area: 'Phone Q&A', feature: 'Grounded answer' },
    });

    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(usageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        operation: 'chat',
        inputTokens: 80,
        outputTokens: 40,
      }),
    );
  });

  it('records exactly one usage event per chatStream at gateway level', async () => {
    const usageSpy = vi.spyOn(usageModule, 'recordLlmUsageEvent').mockResolvedValue();

    const gateway = new ModelGatewayProvider();
    const executor = (gateway as unknown as { executor: CascadeExecutor }).executor;
    vi.spyOn(executor, 'executeStream').mockImplementation(async function* () {
      yield { type: 'text-delta', textDelta: 'delta 1' };
      yield {
        type: 'finish',
        model: 'gemini-3-flash-preview',
        usage: { tokensIn: 100, tokensOut: 50 },
      };
    });

    const deltas: string[] = [];
    for await (const delta of gateway.chatStream({
      model: 'default',
      messages: [{ role: 'user', content: 'Streaming test' }],
      taskClass: 'GROUNDED_SYNTHESIS',
    })) {
      if (delta.type === 'text-delta' && delta.textDelta) {
        deltas.push(delta.textDelta);
      }
    }

    expect(deltas).toEqual(['delta 1']);
    expect(usageSpy).toHaveBeenCalledTimes(1);
    expect(usageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        model: 'gemini-3-flash-preview',
        operation: 'stream',
        inputTokens: 100,
        outputTokens: 50,
      }),
    );
  });
});

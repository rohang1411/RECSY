import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ModelGatewayProvider } from './index';
import type { CascadeExecutor } from './cascade-executor';
import type { ChatResult, StructuredResult } from '../types';

describe('ModelGatewayProvider', () => {
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
});

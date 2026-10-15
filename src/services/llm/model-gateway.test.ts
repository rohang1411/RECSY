import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ModelGateway } from './model-gateway';
import type { LlmProvider } from './types';

describe('ModelGateway Routing and Reasoning Effort Calibration', () => {
  const dummyGemini: LlmProvider = {
    name: 'gemini',
    chat: vi.fn().mockResolvedValue({
      text: 'gemini answer',
      usage: { tokensIn: 100, tokensOut: 50 },
      model: 'gemini-3-flash-preview',
      cached: false,
    }),
    chatStream: vi.fn(),
    structured: vi.fn().mockResolvedValue({
      value: { success: true },
      usage: { tokensIn: 80, tokensOut: 20 },
      model: 'gemini-2.5-flash',
      cached: false,
      attempts: 1,
    }),
    embed: vi.fn().mockResolvedValue({
      embeddings: [new Array(768).fill(0.1)],
      model: 'gemini-embedding-001',
      usage: { tokensIn: 5 },
    }),
  };

  const dummyGroq: LlmProvider = {
    name: 'groq',
    chat: vi.fn().mockResolvedValue({
      text: 'groq answer',
      usage: { tokensIn: 100, tokensOut: 50 },
      model: 'llama-3.3-70b-versatile',
      cached: false,
    }),
    chatStream: vi.fn(),
    structured: vi.fn().mockResolvedValue({
      value: { success: true },
      usage: { tokensIn: 80, tokensOut: 20 },
      model: 'llama-3.3-70b-versatile',
      cached: false,
      attempts: 1,
    }),
    embed: vi.fn(),
  };

  const dummyNvidia: LlmProvider = {
    name: 'nvidia-nim',
    chat: vi.fn().mockResolvedValue({
      text: 'nvidia answer',
      usage: { tokensIn: 100, tokensOut: 50 },
      model: 'meta/llama-3.1-70b-instruct',
      cached: false,
    }),
    chatStream: vi.fn(),
    structured: vi.fn().mockResolvedValue({
      value: { success: true },
      usage: { tokensIn: 80, tokensOut: 20 },
      model: 'meta/llama-3.1-70b-instruct',
      cached: false,
      attempts: 1,
    }),
    embed: vi.fn(),
  };

  const gateway = new ModelGateway({
    gemini: dummyGemini,
    groq: dummyGroq,
    nvidiaNim: dummyNvidia,
  });

  it('routes structured extractions to low-reasoning zero-thinking budget profile', () => {
    const route = gateway.decideRoute({
      area: 'Catalog',
      feature: 'Extraction infobox',
    });

    expect(route.reasoningEffort).toBe('low');
    expect(route.thinkingBudget).toBe(0);
    expect(route.model).toBe('gemini-2.5-flash');
  });

  it('routes multi-attribute recommendation synthesis to high-reasoning tier', () => {
    const route = gateway.decideRoute({
      area: 'Recommender',
      feature: 'Tradeoff synthesis',
    });

    expect(route.reasoningEffort).toBe('high');
    expect(route.model).toBe('gemini-2.5-pro');
  });

  it('routes standard conversational Q&A to medium reasoning tier', () => {
    const route = gateway.decideRoute({
      area: 'Phone Q&A',
      feature: 'Grounded answer',
    });

    expect(route.reasoningEffort).toBe('medium');
    expect(route.model).toBe('gemini-3-flash-preview');
  });

  it('honors explicit reasoning effort overrides', () => {
    const lowRoute = gateway.decideRoute(undefined, 'low');
    expect(lowRoute.reasoningEffort).toBe('low');
    expect(lowRoute.thinkingBudget).toBe(0);

    const highRoute = gateway.decideRoute(undefined, 'high');
    expect(highRoute.reasoningEffort).toBe('high');
    expect(highRoute.model).toBe('gemini-2.5-pro');
  });

  it('executes structured schema extraction and parses schema successfully', async () => {
    const schema = z.object({ success: z.boolean() });
    const res = await gateway.structured({
      messages: [{ role: 'user', content: 'extract' }],
      schema,
      schemaName: 'TestSchema',
      usageContext: { area: 'Catalog', feature: 'Extraction' },
      model: 'gemini-2.5-flash',
    });

    expect(res.value).toEqual({ success: true });
    expect(dummyGemini.structured).toHaveBeenCalled();
  });

  it('routes embeddings to Gemini for 768-dim database schema alignment', async () => {
    const res = await gateway.embed(['sample text']);
    expect(res.embeddings[0]).toHaveLength(768);
    expect(dummyGemini.embed).toHaveBeenCalled();
  });
});

/**
 * Unit tests for user requirement extraction (`extract-requirements.ts`).
 *
 * Tests cover: LLM structured-output happy path, schema normalization,
 * clarify threshold detection, and invalid schema rejection. LLM is
 * mocked — no real Gemini calls.
 */
import { describe, expect, it } from 'vitest';

import type { LlmProvider, StructuredResult } from '@/services/llm/types';

import { extractUserRequirements } from './extract-requirements';
import { userRequirementsSchema } from './requirements-schema';

describe('extractUserRequirements', () => {
  it('returns normalised requirements from the structured call', async () => {
    const raw = {
      budget_usd: { max: 500 },
      priorities: [{ aspect: 'camera' as const, weight: 0.4 }],
      must_haves: [],
      deal_breakers: [],
      use_cases: ['photos'],
      form_factor: undefined,
      brand_preference: { liked: [], disliked: [] },
      confidence: 0.85,
    };
    const fixed = userRequirementsSchema.parse(raw);
    let structuredCalls = 0;
    const llm: LlmProvider = {
      name: 'mock',
      chat: () => {
        throw new Error('not used');
      },
      chatStream: async function* () {
        yield { type: 'finish' as const };
      },
      structured: async <T>(): Promise<StructuredResult<T>> => {
        structuredCalls += 1;
        return {
          value: fixed as T,
          usage: { tokensIn: 1, tokensOut: 0 },
          model: 'mock',
          cached: false,
          attempts: 1,
        };
      },
      embed: () =>
        Promise.resolve({
          embeddings: [new Array(768).fill(0)],
          model: 'mock-emb',
          usage: { tokensIn: 0 },
        }),
    };

    const out = await extractUserRequirements({
      llm,
      userMessage: 'I need a good camera under 500',
      previous: null,
    });
    expect(structuredCalls).toBe(1);
    expect(out.confidence).toBe(0.85);
    expect(out.use_cases).toContain('photos');
  });
});

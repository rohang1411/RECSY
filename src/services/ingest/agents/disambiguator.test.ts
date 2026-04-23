import { describe, expect, it, vi } from 'vitest';

import type { LlmProvider, StructuredInput, StructuredResult } from '@/services/llm/types';

import type { AliasMatch } from './alias-match';
import {
  DisambiguatorAgent,
  type DisambiguatorResult,
  disambiguatorResultSchema,
} from './disambiguator';

const CANDIDATES: readonly AliasMatch[] = [
  {
    phoneId: 'p-s25u',
    slug: 'samsung-galaxy-s25-ultra',
    alias: 'Galaxy S25 Ultra',
    priority: 100,
  },
  {
    phoneId: 'p-p9pxl',
    slug: 'google-pixel-9-pro-xl',
    alias: 'Pixel 9 Pro XL',
    priority: 100,
  },
];

function fakeLlm(result: DisambiguatorResult): LlmProvider {
  return {
    name: 'fake',
    chat: vi.fn(),
    chatStream: vi.fn(),
    structured: vi.fn(
      async <T>(_input: StructuredInput<T>): Promise<StructuredResult<T>> => ({
        value: result as unknown as T,
        usage: { tokensIn: 60, tokensOut: 25 },
        model: 'fake',
        cached: false,
        attempts: 1,
      }),
    ),
    embed: vi.fn(),
  } as unknown as LlmProvider;
}

describe('DisambiguatorAgent.resolve', () => {
  it('requires >=2 candidates', async () => {
    const agent = new DisambiguatorAgent(
      fakeLlm({
        primarySlug: 'samsung-galaxy-s25-ultra',
        primaryConfidence: 0.9,
        secondary: [],
        reason: 'n/a',
      }),
    );
    await expect(
      agent.resolve({
        sourceType: 'youtube',
        title: 'Galaxy S25 Ultra review',
        candidates: [CANDIDATES[0]!],
      }),
    ).rejects.toThrow(/>= 2/);
  });

  it('picks primary and classifies secondary', async () => {
    const agent = new DisambiguatorAgent(
      fakeLlm({
        primarySlug: 'samsung-galaxy-s25-ultra',
        primaryConfidence: 0.85,
        secondary: [{ slug: 'google-pixel-9-pro-xl', relevance: 0.6 }],
        reason: 'S25 Ultra gets majority of screen time.',
      }),
    );

    const decision = await agent.resolve({
      sourceType: 'youtube',
      title: 'S25 Ultra vs Pixel 9 Pro XL — ultimate camera showdown',
      candidates: CANDIDATES,
    });

    expect(decision.primary.slug).toBe('samsung-galaxy-s25-ultra');
    expect(decision.primaryConfidence).toBe(0.85);
    expect(decision.secondary).toHaveLength(1);
    expect(decision.secondary[0]!.match.slug).toBe('google-pixel-9-pro-xl');
    expect(decision.secondary[0]!.relevance).toBe(0.6);
    expect(decision.fallback).toBe(false);
  });

  it('falls back when LLM returns unknown slug', async () => {
    const agent = new DisambiguatorAgent(
      fakeLlm({
        primarySlug: 'not-a-real-slug',
        primaryConfidence: 0.9,
        secondary: [],
        reason: 'oops',
      }),
    );
    const decision = await agent.resolve({
      sourceType: 'youtube',
      title: 'S25 Ultra vs Pixel 9 Pro XL',
      candidates: CANDIDATES,
    });
    expect(decision.fallback).toBe(true);
    expect(decision.primary.slug).toBe('samsung-galaxy-s25-ultra'); // first candidate
  });

  it('falls back when LLM throws', async () => {
    const brokenLlm: LlmProvider = {
      name: 'broken',
      chat: vi.fn(),
      chatStream: vi.fn(),
      structured: vi.fn(async () => {
        throw new Error('boom');
      }),
      embed: vi.fn(),
    } as unknown as LlmProvider;
    const agent = new DisambiguatorAgent(brokenLlm);
    const decision = await agent.resolve({
      sourceType: 'youtube',
      title: 'S25 Ultra vs Pixel 9 Pro XL',
      candidates: CANDIDATES,
    });
    expect(decision.fallback).toBe(true);
    expect(decision.reason).toContain('llm-error');
  });

  it('schema parses valid output', () => {
    const parsed = disambiguatorResultSchema.parse({
      primarySlug: 'x',
      primaryConfidence: 0.7,
      secondary: [{ slug: 'y', relevance: 0.5 }],
      reason: 'ok',
    });
    expect(parsed.primarySlug).toBe('x');
  });
});

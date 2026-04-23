import { describe, expect, it, vi } from 'vitest';
import type { z } from 'zod';

import type { LlmProvider, StructuredInput, StructuredResult } from '@/services/llm/types';

import type { RawChunk, RawSource } from '../types';
import { CuratorAgent, type CuratorVerdict, curatorVerdictSchema } from './curator';

function fakeLlm(verdict: CuratorVerdict): LlmProvider {
  return {
    name: 'fake',
    chat: vi.fn(),
    chatStream: vi.fn(),
    structured: vi.fn(async <T>(_input: StructuredInput<T>): Promise<StructuredResult<T>> => {
      return {
        value: verdict as unknown as T,
        usage: { tokensIn: 100, tokensOut: 40 },
        model: 'fake',
        cached: false,
        attempts: 1,
      };
    }),
    embed: vi.fn(),
  } as unknown as LlmProvider;
}

const raw: RawSource = {
  candidate: {
    url: 'https://example.com/a',
    title: 'Pixel 9 Pro XL deep dive',
    author: 'Reviewer X',
    channel: 'TestChannel',
    language: 'en',
    publishedAt: null,
    raw: {},
  },
  contentHash: 'abc',
  body: 'body',
  raw: {},
};

const sampleChunks: RawChunk[] = [
  { chunkIndex: 0, text: 'Chunk zero content about camera and display.', tokens: 50 },
  { chunkIndex: 1, text: 'Chunk one about battery life and performance.', tokens: 50 },
];

describe('CuratorAgent.decide', () => {
  it('keeps sources above both thresholds', async () => {
    const agent = new CuratorAgent(
      fakeLlm({
        keep: true,
        relevance: 0.85,
        quality: 0.7,
        aspectsCovered: ['camera', 'battery'],
        sentimentSummary: 'positive',
        reason: 'Focused review.',
      }),
    );

    const decision = await agent.decide({
      phone: { slug: 'google-pixel-9-pro-xl', brand: 'Google', model: 'Pixel 9 Pro XL' },
      sourceType: 'article',
      raw,
      sampleChunks,
    });
    expect(decision.keep).toBe(true);
    expect(decision.rejectedReason).toBeNull();
    expect(decision.verdict.relevance).toBe(0.85);
  });

  it('rejects when `keep=false` with curator:<reason>', async () => {
    const agent = new CuratorAgent(
      fakeLlm({
        keep: false,
        relevance: 0.2,
        quality: 0.4,
        aspectsCovered: [],
        sentimentSummary: 'neutral',
        reason: 'Comparison mostly about a different phone.',
      }),
    );
    const decision = await agent.decide({
      phone: { slug: 'google-pixel-9-pro-xl', brand: 'Google', model: 'Pixel 9 Pro XL' },
      sourceType: 'youtube',
      raw,
      sampleChunks,
    });
    expect(decision.keep).toBe(false);
    expect(decision.rejectedReason).toMatch(/^curator:/);
  });

  it('rejects with low-relevance when relevance falls below threshold', async () => {
    const agent = new CuratorAgent(
      fakeLlm({
        keep: true, // curator says keep, thresholds override
        relevance: 0.3,
        quality: 0.8,
        aspectsCovered: ['camera'],
        sentimentSummary: 'positive',
        reason: 'Brief mention in roundup.',
      }),
    );
    const decision = await agent.decide({
      phone: { slug: 'google-pixel-9-pro-xl', brand: 'Google', model: 'Pixel 9 Pro XL' },
      sourceType: 'article',
      raw,
      sampleChunks,
    });
    expect(decision.keep).toBe(false);
    expect(decision.rejectedReason).toMatch(/^low-relevance:/);
  });

  it('rejects with low-quality when quality falls below threshold', async () => {
    const agent = new CuratorAgent(
      fakeLlm({
        keep: true,
        relevance: 0.9,
        quality: 0.2,
        aspectsCovered: ['camera'],
        sentimentSummary: 'mixed',
        reason: 'Spec list.',
      }),
    );
    const decision = await agent.decide({
      phone: { slug: 'google-pixel-9-pro-xl', brand: 'Google', model: 'Pixel 9 Pro XL' },
      sourceType: 'article',
      raw,
      sampleChunks,
    });
    expect(decision.keep).toBe(false);
    expect(decision.rejectedReason).toMatch(/^low-quality:/);
  });

  it('degrades to keep on LLM failure', async () => {
    const brokenLlm: LlmProvider = {
      name: 'broken',
      chat: vi.fn(),
      chatStream: vi.fn(),
      structured: vi.fn(async () => {
        throw new Error('network');
      }),
      embed: vi.fn(),
    } as unknown as LlmProvider;

    const agent = new CuratorAgent(brokenLlm);
    const decision = await agent.decide({
      phone: { slug: 'google-pixel-9-pro-xl', brand: 'Google', model: 'Pixel 9 Pro XL' },
      sourceType: 'article',
      raw,
      sampleChunks,
    });
    expect(decision.keep).toBe(true);
    expect(decision.verdict.reason).toContain('curator-error');
  });

  it('schema is defined and parses sensible verdicts', () => {
    const parsed: z.infer<typeof curatorVerdictSchema> = curatorVerdictSchema.parse({
      keep: true,
      relevance: 0.5,
      quality: 0.5,
      aspectsCovered: [],
      sentimentSummary: 'neutral',
      reason: 'ok',
    });
    expect(parsed.keep).toBe(true);
  });
});

/**
 * Unit tests for the recommendation pipeline explain helper (`recommend-explain.ts`).
 *
 * Tests cover: `getRecommendationDemo` returns an object with the expected shape
 * (id, title, requirements, funnel array, picks array). The test reads from the
 * fixture file on disk — no LLM or DB calls.
 */
import { describe, expect, it } from 'vitest';

import { getRecommendationDemo } from './recommend-explain';

describe('getRecommendationDemo', () => {
  it('returns a RecommendationDemo with required fields', async () => {
    const demo = await getRecommendationDemo();
    expect(demo).toBeDefined();
    expect(typeof demo.id).toBe('string');
    expect(typeof demo.title).toBe('string');
    expect(typeof demo.userMessage).toBe('string');
    expect(typeof demo.latencyMs).toBe('number');
    expect(typeof demo.intent).toBe('string');
    expect(Array.isArray(demo.funnel)).toBe(true);
    expect(Array.isArray(demo.picks)).toBe(true);
  });

  it('requirements object has expected structure', async () => {
    const demo = await getRecommendationDemo();
    const req = demo.requirements;
    expect(typeof req.budgetUsd).toBe('number');
    expect(Array.isArray(req.priorities)).toBe(true);
    expect(Array.isArray(req.mustHaves)).toBe(true);
    expect(Array.isArray(req.tradeoffs)).toBe(true);
  });

  it('funnel entries have label, count, and detail', async () => {
    const demo = await getRecommendationDemo();
    for (const stage of demo.funnel) {
      expect(typeof stage.label).toBe('string');
      expect(typeof stage.count).toBe('number');
      expect(typeof stage.detail).toBe('string');
    }
  });

  it('picks have required shape (rank, phoneSlug, score)', async () => {
    const demo = await getRecommendationDemo();
    for (const pick of demo.picks) {
      expect(typeof pick.rank).toBe('number');
      expect(typeof pick.phoneSlug).toBe('string');
      expect(typeof pick.score).toBe('number');
      expect(Array.isArray(pick.contributions)).toBe(true);
    }
  });
});

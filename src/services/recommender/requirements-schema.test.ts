import { describe, expect, it } from 'vitest';

import { normalizeUserRequirements, userRequirementsSchema } from './requirements-schema';

describe('userRequirementsSchema (LLM-tolerant parse)', () => {
  it('accepts title-case aspect names and 0–100 style weights', () => {
    const out = userRequirementsSchema.parse({
      budget_usd: { max: 800 },
      priorities: [
        { aspect: 'Camera', weight: 8 },
        { aspect: 'BATTERY', weight: 2 },
      ],
      must_haves: [],
      deal_breakers: [],
      use_cases: ['photography', 'all-day use'],
      form_factor: null,
      brand_preference: null,
      confidence: 0.88,
    });
    const n = normalizeUserRequirements(out);
    expect(n.priorities[0]?.aspect).toBe('camera');
    expect(n.priorities[0]?.weight).toBeCloseTo(0.8, 5);
  });

  it('accepts budget as a number or currency string and bare max', () => {
    expect(
      userRequirementsSchema.parse({
        budget_usd: 800,
        priorities: [],
        must_haves: [],
        deal_breakers: [],
        use_cases: [],
        confidence: 0.5,
      }).budget_usd,
    ).toEqual({ max: 800 });

    expect(
      userRequirementsSchema.parse({
        budget_usd: { max: '$800' },
        priorities: [],
        must_haves: [],
        deal_breakers: [],
        use_cases: [],
        confidence: 0.5,
      }).budget_usd,
    ).toEqual({ max: 800 });
  });

  it('maps screen_size_min_in / max_in to a sorted tuple after normalise', () => {
    const out = userRequirementsSchema.parse({
      budget_usd: { max: 800 },
      priorities: [],
      must_haves: [],
      deal_breakers: [],
      use_cases: [],
      form_factor: { screen_size_max_in: 6.7, screen_size_min_in: 6.1 },
      brand_preference: { liked: [], disliked: [] },
      confidence: 0.7,
    });
    const n = normalizeUserRequirements(out);
    expect(n.form_factor?.screen_size_range_in).toEqual([6.1, 6.7]);
  });

  it('accepts legacy screen_size_range_in tuple in parse and normalises to tuple', () => {
    const out = userRequirementsSchema.parse({
      budget_usd: { max: 500 },
      priorities: [],
      must_haves: [],
      deal_breakers: [],
      use_cases: [],
      form_factor: { screen_size_range_in: [6.8, 6.0] } as object,
      brand_preference: { liked: [], disliked: [] },
      confidence: 0.6,
    });
    const n = normalizeUserRequirements(out);
    expect(n.form_factor?.screen_size_range_in).toEqual([6.0, 6.8]);
  });

  it('accepts string confidence and integer percent', () => {
    expect(
      userRequirementsSchema.parse({
        budget_usd: { max: 500 },
        priorities: [],
        must_haves: [],
        deal_breakers: [],
        use_cases: [],
        confidence: '0.7',
      }).confidence,
    ).toBe(0.7);
    expect(
      userRequirementsSchema.parse({
        budget_usd: { max: 500 },
        priorities: [],
        must_haves: [],
        deal_breakers: [],
        use_cases: [],
        confidence: 85,
      }).confidence,
    ).toBe(0.85);
  });
});

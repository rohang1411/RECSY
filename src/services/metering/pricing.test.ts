import { describe, expect, it } from 'vitest';
import { MODEL_PRICING_MAP, estimateQueryCostMicros } from './pricing';
import { TIER_MODEL_POOLS } from '@/services/llm/gateway/task-profiles';

describe('Metering Pricing Model Map', () => {
  it('covers all models in TIER_MODEL_POOLS', () => {
    for (const [tier, candidates] of Object.entries(TIER_MODEL_POOLS)) {
      for (const candidate of candidates) {
        expect(
          MODEL_PRICING_MAP[candidate.model],
          `Missing pricing entry for model '${candidate.model}' in tier '${tier}'`,
        ).toBeDefined();
        expect(MODEL_PRICING_MAP[candidate.model]!.inPerMTok).toBeGreaterThanOrEqual(0);
        expect(MODEL_PRICING_MAP[candidate.model]!.outPerMTok).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('calculates query cost in micro-USD correctly', () => {
    // 1000 input tokens of gpt-4o-mini (150,000 / MTok) = 150 micros
    // 500 output tokens of gpt-4o-mini (600,000 / MTok) = 300 micros
    // Total = 450 micros
    const cost = estimateQueryCostMicros('gpt-4o-mini', 1000, 500);
    expect(cost).toBe(450);
  });

  it('handles zero tokens and null model gracefully', () => {
    expect(estimateQueryCostMicros(null, 0, 0)).toBe(0);
    expect(estimateQueryCostMicros('unknown-model', 1000, 1000)).toBeGreaterThan(0);
  });
});

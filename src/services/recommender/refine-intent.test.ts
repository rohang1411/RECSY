/**
 * Unit tests for refine-intent detection (`refine-intent.ts`).
 *
 * Tests cover: true positives (messages that reference prior picks),
 * true negatives (fresh requests), and edge cases (very short messages,
 * messages with numbers that aren't pick references). Pure.
 */
import { describe, expect, it } from 'vitest';

import { detectRefineIntent } from './refine-intent';

describe('detectRefineIntent', () => {
  describe('true positives', () => {
    const positives = [
      'which one should I prefer for the best performance out of these 3',
      'of these, which is best for battery?',
      'rank them for gaming',
      'compare the top two for me',
      'between these three, which has the best camera?',
      'which of the three you showed is lightest?',
      'best one here for one-handed use',
      'of the phones you suggested, which lasts longest on a charge',
      'out of these which wins for gaming',
    ];
    for (const msg of positives) {
      it(`detects refine in: ${JSON.stringify(msg)}`, () => {
        const result = detectRefineIntent(msg);
        expect(result.refine).toBe(true);
      });
    }
  });

  describe('new-query hints override', () => {
    const newQueries = [
      'now rank them under $500',
      'show me different phones instead',
      'forget those — find me a foldable',
      'start over with a $2000 budget',
      'instead of these, something cheaper',
    ];
    for (const msg of newQueries) {
      it(`treats as new query: ${JSON.stringify(msg)}`, () => {
        const result = detectRefineIntent(msg);
        expect(result.refine).toBe(false);
        expect(result.rejected.length).toBeGreaterThan(0);
      });
    }
  });

  describe('true negatives', () => {
    const negatives = [
      'I want a phone under $800 with the best camera',
      'recommend a good foldable',
      'do you have anything lighter',
      '',
    ];
    for (const msg of negatives) {
      it(`does not detect refine in: ${JSON.stringify(msg)}`, () => {
        expect(detectRefineIntent(msg).refine).toBe(false);
      });
    }
  });

  it('rejects long messages without strong refine signal', () => {
    const long =
      'which is the one that best fits my needs given that I travel a lot and also care about battery but not too much, and I want a decent camera and a screen not too small or too large, maybe around 6.3 inches or so';
    const result = detectRefineIntent(long);
    expect(result.refine).toBe(false);
  });
});

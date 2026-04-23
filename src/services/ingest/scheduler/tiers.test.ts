import { describe, expect, it } from 'vitest';

import { classifyTier, computeNextIngestAt } from './tiers';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

describe('classifyTier', () => {
  it('hot for launches within 60 days', () => {
    expect(classifyTier(daysAgo(10))).toBe('hot');
    expect(classifyTier(daysAgo(59))).toBe('hot');
  });
  it('warm for launches within 12 months', () => {
    expect(classifyTier(daysAgo(61))).toBe('warm');
    expect(classifyTier(daysAgo(360))).toBe('warm');
  });
  it('cold for older launches', () => {
    expect(classifyTier(daysAgo(400))).toBe('cold');
  });
  it('cold when launch date missing', () => {
    expect(classifyTier(null)).toBe('cold');
    expect(classifyTier(undefined)).toBe('cold');
  });
});

describe('computeNextIngestAt', () => {
  it('hot = +3.5 days', () => {
    const from = new Date('2025-01-01T00:00:00Z');
    const next = computeNextIngestAt('hot', from);
    expect(next.getUTCDate()).toBe(4);
    expect(next.getUTCHours()).toBe(12);
  });
  it('warm = +7 days', () => {
    const from = new Date('2025-01-01T00:00:00Z');
    expect(computeNextIngestAt('warm', from).getUTCDate()).toBe(8);
  });
  it('cold = +14 days', () => {
    const from = new Date('2025-01-01T00:00:00Z');
    expect(computeNextIngestAt('cold', from).getUTCDate()).toBe(15);
  });
});

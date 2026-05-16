/**
 * Unit tests for scorecard recency confidence boost (`recency.ts`).
 *
 * Tests cover: boost applied when majority of evidence is recent, no
 * boost for old evidence, correct bump magnitude, and edge cases
 * (no evidence, all evidence at boundary). Uses fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RetrievedChunk } from '@/services/retrieval/types';

import { SCORECARD_RECENCY_WINDOW_MS } from './constants';
import { recencyConfidenceBoost } from './recency';

function chunk(publishedAt: Date | null): RetrievedChunk {
  return {
    chunkId: '00000000-0000-4000-8000-000000000001',
    sourceId: '00000000-0000-4000-8000-0000000000aa',
    text: 'x',
    score: 0,
    source: {
      id: '00000000-0000-4000-8000-0000000000aa',
      url: 'https://example.com',
      title: 't',
      type: 'article',
      author: null,
      channel: null,
      publishedAt,
    },
  };
}

describe('recencyConfidenceBoost', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 when no chunks have publishedAt', () => {
    expect(recencyConfidenceBoost([chunk(null), chunk(null)])).toBe(0);
  });

  it('returns 0 when the list is empty', () => {
    expect(recencyConfidenceBoost([])).toBe(0);
  });

  it('adds a bounded bump when evidence is mostly fresh', () => {
    vi.setSystemTime(new Date('2026-06-01T12:00:00.000Z'));
    const fresh = new Date('2026-05-20T12:00:00.000Z');
    const old = new Date('2020-01-01T12:00:00.000Z');
    const low = recencyConfidenceBoost([chunk(old)]);
    const high = recencyConfidenceBoost([chunk(fresh), chunk(fresh)]);
    expect(low).toBe(0);
    expect(high).toBeGreaterThan(0);
    expect(high).toBeLessThanOrEqual(0.12);
  });

  it('treats sources inside the recency window as fresh', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    vi.setSystemTime(now);
    const edge = new Date(now.getTime() - SCORECARD_RECENCY_WINDOW_MS);
    expect(recencyConfidenceBoost([chunk(edge)])).toBeGreaterThan(0);
  });
});

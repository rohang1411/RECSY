/**
 * Unit tests for creator profile seed data (`creator-profiles.ts`).
 *
 * Verifies that `CREATOR_SEEDS` uses the correct, currently-valid YouTube
 * channel IDs for all monitored creator handles. This is a canary test —
 * if a YouTube channel ID is updated, this test must be updated too. The
 * test prevents re-introduction of the broken channel IDs from commit
 * 2f18ff1 (The Verge, Booredatwork, Apple, SuperSaf Shorts).
 *
 * Pure — no network, no DB.
 */
import { describe, expect, it } from 'vitest';

import { CREATOR_SEEDS } from './creator-profiles';

describe('creator profile seeds', () => {
  it('uses verified YouTube channel IDs for the monitored creator handles', () => {
    const idsByHandle = new Map(CREATOR_SEEDS.map((seed) => [seed.handle, seed.externalId]));

    expect(idsByHandle.get('MKBHD')).toBe('UCBJycsmduvYEL83R_U4JriQ');
    expect(idsByHandle.get('Mrwhosetheboss')).toBe('UCMiJRAwDNSNzuYeN2uWa0pA');
    expect(idsByHandle.get('TheTechChap')).toBe('UCzlXf-yUIaOpOjEjPrOO9TA');
    expect(idsByHandle.get('SuperSaf')).toBe('UCIrrRLyFMVmmL9NDAU2obJA');
    expect(idsByHandle.get('TheUnlockr')).toBe('UCaDBRJTQhIg_QhCkW7SxWGQ');
    expect(idsByHandle.get('MrMobile')).toBe('UCSOpcUkE-is7u7c4AkLgqTw');
  });

  it('does not seed duplicate creator handles or external IDs', () => {
    const handles = new Set(CREATOR_SEEDS.map((seed) => seed.handle));
    const externalIds = new Set(CREATOR_SEEDS.map((seed) => seed.externalId));

    expect(handles.size).toBe(CREATOR_SEEDS.length);
    expect(externalIds.size).toBe(CREATOR_SEEDS.length);
    for (const seed of CREATOR_SEEDS) {
      expect(seed.externalId).toMatch(/^UC[a-zA-Z0-9_-]{20,}$/);
    }
  });
});

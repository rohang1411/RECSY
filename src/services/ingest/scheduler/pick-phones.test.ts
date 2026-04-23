import { describe, expect, it } from 'vitest';

import { shardIndex } from './pick-phones';

describe('shardIndex', () => {
  it('returns 0 when totalShards <= 1', () => {
    expect(shardIndex('abc', 1)).toBe(0);
  });

  it('is deterministic per id', () => {
    const a = shardIndex('phone-id-1', 4);
    const b = shardIndex('phone-id-1', 4);
    expect(a).toBe(b);
  });

  it('distributes across shards reasonably', () => {
    const buckets = new Array(4).fill(0) as number[];
    for (let i = 0; i < 1_000; i++) {
      buckets[shardIndex(`phone-${i}`, 4)]++;
    }
    // Sanity check: every shard should get SOME phones. The distribution
    // won't be exactly uniform but it should be within an order of magnitude.
    for (const b of buckets) {
      expect(b).toBeGreaterThan(100);
      expect(b).toBeLessThan(500);
    }
  });
});

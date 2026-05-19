/**
 * Unit tests for catalog snapshot helpers.
 *
 * Tests cover: stable key generation, URL fallback keys, and deterministic
 * JSON hashing independent of object property order.
 */
import { describe, expect, it } from 'vitest';

import { hashJson, stableCandidateKey } from './snapshots';

describe('catalog snapshot helpers', () => {
  it('uses external identity for stable keys when available', () => {
    expect(stableCandidateKey({ sourceKey: 'wikidata', externalId: 'Q123' })).toBe('wikidata:Q123');
  });

  it('falls back to canonicalized URL hash', () => {
    const a = stableCandidateKey({
      sourceKey: 'oem',
      sourceUrl: 'https://example.com/p?utm_source=x&id=1',
    });
    const b = stableCandidateKey({
      sourceKey: 'oem',
      sourceUrl: 'https://example.com/p?id=1',
    });
    expect(a).toBe(b);
  });

  it('hashes JSON deterministically regardless of property order', () => {
    expect(hashJson({ b: 2, a: 1 })).toBe(hashJson({ a: 1, b: 2 }));
  });
});

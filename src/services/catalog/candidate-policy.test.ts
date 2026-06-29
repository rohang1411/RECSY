import { describe, expect, it } from 'vitest';

import {
  catalogReleaseRetryAfter,
  compareCatalogPriorityThenNewest,
  isFutureCatalogDate,
  isLikelyCatalogPhoneTitle,
  isReleasedCatalogCandidate,
  isWeakCatalogReleaseDate,
} from './candidate-policy';

describe('catalog candidate policy', () => {
  const now = new Date('2026-05-31T12:00:00Z');

  it('treats tomorrow and later as unreleased', () => {
    expect(isFutureCatalogDate('2026-05-31', now)).toBe(false);
    expect(isFutureCatalogDate('2026-06-01', now)).toBe(true);
    expect(isReleasedCatalogCandidate({ launchDate: '2026-09-19' }, now)).toBe(false);
  });

  it('keeps obvious non-phones and combined device titles out of enrichment', () => {
    expect(isLikelyCatalogPhoneTitle('Apple iPhone 17 Pro')).toBe(true);
    expect(isLikelyCatalogPhoneTitle('Apple iPad Air 13 2026')).toBe(false);
    expect(isLikelyCatalogPhoneTitle('Apple iPhone 17 Pro and iPhone 17 Pro Max')).toBe(false);
  });

  it('sorts by mainstream brand priority before newest release date', () => {
    const sorted = [
      { brand: '8849', model: 'Tank 4 Pro', launchDate: '2026-05-30' },
      { brand: 'Samsung', model: 'Galaxy S25 Edge', launchDate: '2026-05-15' },
      { brand: 'Apple', model: 'iPhone 16e', launchDate: '2026-02-28' },
      { brand: 'Apple', model: 'iPhone 17', launchDate: '2026-09-19' },
    ].sort(compareCatalogPriorityThenNewest);

    expect(sorted.map((item) => item.model)).toEqual([
      'iPhone 17',
      'iPhone 16e',
      'Galaxy S25 Edge',
      'Tank 4 Pro',
    ]);
  });

  it('defers unreleased candidates until after their release date', () => {
    expect(catalogReleaseRetryAfter('2026-09-19', now).toISOString()).toBe(
      '2026-09-20T00:00:00.000Z',
    );
  });

  it('detects weak rumored release-date text', () => {
    expect(isWeakCatalogReleaseDate('Exp. announcement 2026')).toBe(true);
    expect(isWeakCatalogReleaseDate('Expected launch 2026')).toBe(true);
    expect(isWeakCatalogReleaseDate('2026-01-01')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';

import {
  browseFiltersToQueryString,
  isDefaultBrowseState,
  parseBrowseSearchParams,
} from './search-params';

describe('parseBrowseSearchParams', () => {
  it('defaults when empty', () => {
    const s = parseBrowseSearchParams(new URLSearchParams());
    expect(isDefaultBrowseState(s)).toBe(true);
  });

  it('parses min/max and swaps when reversed in URL', () => {
    const s = parseBrowseSearchParams(new URLSearchParams('min=800&max=200'));
    expect(s.minPriceUsd).toBe(200);
    expect(s.maxPriceUsd).toBe(800);
  });

  it('parses foldable=1 and foldable=0', () => {
    expect(parseBrowseSearchParams(new URLSearchParams('foldable=1')).foldable).toBe('yes');
    expect(parseBrowseSearchParams(new URLSearchParams('foldable=0')).foldable).toBe('no');
  });

  it('parses brands comma list', () => {
    const s = parseBrowseSearchParams(new URLSearchParams('brands=Google,%20Samsung'));
    expect(s.brands).toEqual(['Google', 'Samsung']);
  });

  it('parses repeated brand= from checkboxes', () => {
    const s = parseBrowseSearchParams(
      new URLSearchParams('brand=Google&brand=Nothing&min=0&max=9999'),
    );
    expect(s.brands).toEqual(['Google', 'Nothing']);
  });
});

describe('browseFiltersToQueryString', () => {
  it('round-trips a non-default state', () => {
    const s = {
      brands: ['Google'],
      minPriceUsd: 400,
      maxPriceUsd: 900,
      foldable: 'no' as const,
    };
    const q = browseFiltersToQueryString(s);
    const back = parseBrowseSearchParams(new URLSearchParams(q));
    expect(back).toEqual(s);
  });
});

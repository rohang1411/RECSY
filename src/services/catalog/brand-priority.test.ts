/**
 * Unit tests for catalog brand prioritization.
 */
import { describe, expect, it } from 'vitest';

import { brandPriorityRank, isMainstreamPriorityBrand } from './brand-priority';

describe('catalog brand priority', () => {
  it('ranks mainstream smartphone companies and sub-brands first', () => {
    expect(brandPriorityRank('Apple')).toBe(1);
    expect(brandPriorityRank('Samsung')).toBe(2);
    expect(brandPriorityRank('Google')).toBe(3);
    expect(brandPriorityRank('Pixel')).toBe(3);
    expect(brandPriorityRank('OnePlus')).toBe(4);
    expect(brandPriorityRank('Nothing')).toBe(5);
    expect(brandPriorityRank('CMF by Nothing')).toBe(5);
    expect(brandPriorityRank('Motorola')).toBe(6);
    expect(brandPriorityRank('Redmi')).toBe(7);
    expect(brandPriorityRank('iQOO')).toBe(8);
    expect(brandPriorityRank('Infinix')).toBe(11);
  });

  it('leaves non-priority brands eligible after mainstream brands', () => {
    expect(isMainstreamPriorityBrand('8849')).toBe(false);
    expect(brandPriorityRank('8849')).toBe(Number.MAX_SAFE_INTEGER);
  });
});

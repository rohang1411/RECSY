import { describe, expect, it } from 'vitest';

import { matchAliases, normaliseText, type AliasRow } from './alias-match';

const ALIASES: readonly AliasRow[] = [
  { phoneId: 'p1', slug: 'samsung-galaxy-s25-ultra', alias: 'Galaxy S25 Ultra', priority: 100 },
  { phoneId: 'p1', slug: 'samsung-galaxy-s25-ultra', alias: 'S25 Ultra', priority: 90 },
  { phoneId: 'p2', slug: 'samsung-galaxy-s25', alias: 'Galaxy S25', priority: 100 },
  { phoneId: 'p2', slug: 'samsung-galaxy-s25', alias: 'S25', priority: 50 },
  { phoneId: 'p3', slug: 'google-pixel-9-pro', alias: 'Pixel 9 Pro', priority: 100 },
  { phoneId: 'p4', slug: 'google-pixel-9-pro-xl', alias: 'Pixel 9 Pro XL', priority: 100 },
  { phoneId: 'p5', slug: 'samsung-galaxy-s25-plus', alias: 'Galaxy S25+', priority: 100 },
];

describe('normaliseText', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normaliseText('   Hello   WORLD  ')).toBe('hello world');
  });
  it('keeps + and digits intact', () => {
    expect(normaliseText('Galaxy S25+ review!')).toBe('galaxy s25+ review');
  });
  it('normalises unicode dashes', () => {
    expect(normaliseText('iPhone — review')).toBe('iphone - review');
  });
});

describe('matchAliases', () => {
  it('matches a single phone from a clean title', () => {
    const matches = matchAliases('Galaxy S25 Ultra review — battery king?', ALIASES);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.slug).toBe('samsung-galaxy-s25-ultra');
  });

  it('prefers longer alias when both match', () => {
    const matches = matchAliases('Pixel 9 Pro XL vs iPhone', ALIASES);
    expect(matches[0]!.slug).toBe('google-pixel-9-pro-xl');
  });

  it('returns multiple phones for comparison titles', () => {
    const matches = matchAliases('Galaxy S25 Ultra vs Pixel 9 Pro XL', ALIASES);
    const slugs = matches.map((m) => m.slug);
    expect(slugs).toContain('samsung-galaxy-s25-ultra');
    expect(slugs).toContain('google-pixel-9-pro-xl');
  });

  it('respects word boundaries (does not match "s25" inside "s256")', () => {
    const matches = matchAliases('Random s256 benchmark', ALIASES);
    expect(matches).toHaveLength(0);
  });

  it('handles `+` in alias (S25+)', () => {
    const matches = matchAliases('Galaxy S25+ first impressions', ALIASES);
    expect(matches[0]!.slug).toBe('samsung-galaxy-s25-plus');
  });

  it('does not match S25 Ultra as plain S25', () => {
    // We should match p1 (S25 Ultra) not p2 (S25) — longer alias wins.
    const matches = matchAliases('Galaxy S25 Ultra long term', ALIASES);
    // The S25-only alias may also match, but it should not outrank S25 Ultra
    // AND both phones are different so they may both be returned. Ensure
    // S25 Ultra is first.
    expect(matches[0]!.slug).toBe('samsung-galaxy-s25-ultra');
  });

  it('returns empty array on empty text', () => {
    expect(matchAliases('', ALIASES)).toEqual([]);
  });
});

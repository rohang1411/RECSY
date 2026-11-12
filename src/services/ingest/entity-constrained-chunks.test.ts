import { describe, expect, it } from 'vitest';
import { matchAliases, type AliasRow } from './agents/alias-match';

describe('Entity-Constrained Comparison Chunk Association', () => {
  const aliases: readonly AliasRow[] = [
    { phoneId: 'phone-16-pro', slug: 'iphone-16-pro', alias: 'iphone 16 pro', priority: 1 },
    { phoneId: 'phone-15-pro', slug: 'iphone-15-pro', alias: 'iphone 15 pro', priority: 1 },
    { phoneId: 'phone-s24-ultra', slug: 'galaxy-s24-ultra', alias: 's24 ultra', priority: 1 },
  ];

  it('selectively matches only chunks that explicitly mention the secondary phone', () => {
    const _primaryPhoneId = 'phone-16-pro';
    const secondaryPhoneId = 'phone-15-pro';
    const secondaryAliases = aliases.filter((a) => a.phoneId === secondaryPhoneId);

    const chunk1 = 'The iPhone 16 Pro introduces the A18 Pro silicon with 1.2mm titanium borders.';
    const chunk2 =
      'Comparing battery endurance against the iPhone 15 Pro, the newer model lasts roughly 2 hours longer.';
    const chunk3 =
      'The Camera Control button on the right side provides quick access to zoom slider controls.';

    // Chunk 1 mentions primary only -> secondary should be empty
    expect(matchAliases(chunk1, secondaryAliases)).toHaveLength(0);

    // Chunk 2 mentions secondary -> secondary should match
    const matches2 = matchAliases(chunk2, secondaryAliases);
    expect(matches2).toHaveLength(1);
    expect(matches2[0]!.phoneId).toBe(secondaryPhoneId);

    // Chunk 3 mentions generic camera control -> secondary should be empty
    expect(matchAliases(chunk3, secondaryAliases)).toHaveLength(0);
  });

  it('formats comparison chunk text with comparison excerpt header without altering original core text', () => {
    const rawText =
      'Under sustained 3DMark stress tests, the older chassis thermal throttles 15% sooner.';
    const primarySlug = 'iphone-16-pro';
    const formatted = `[COMPARISON EXCERPT: Comparing ${primarySlug} vs Secondary Reference]\n${rawText}`;

    expect(formatted.startsWith('[COMPARISON EXCERPT:')).toBe(true);
    expect(formatted.includes(rawText)).toBe(true);
    expect(formatted.includes(primarySlug)).toBe(true);
  });
});

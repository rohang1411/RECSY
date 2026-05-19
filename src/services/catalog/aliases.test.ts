/**
 * Unit tests for conservative catalog alias generation.
 *
 * Tests cover: safe full-name aliases, sibling collision rejection, and
 * existing alias collision handling.
 */
import { describe, expect, it } from 'vitest';

import { generateAliasCandidates } from './aliases';

describe('generateAliasCandidates', () => {
  it('keeps full official aliases', () => {
    const result = generateAliasCandidates({
      brand: 'Samsung',
      model: 'Galaxy S25 Ultra',
      slug: 'samsung-galaxy-s25-ultra',
    });
    expect(result.accepted.map((a) => a.alias)).toContain('Samsung Galaxy S25 Ultra');
    expect(result.accepted.map((a) => a.alias)).toContain('Galaxy S25 Ultra');
  });

  it('does not invent bare generation aliases when siblings could be shadowed', () => {
    const result = generateAliasCandidates({
      brand: 'Samsung',
      model: 'Galaxy S25',
      slug: 'samsung-galaxy-s25',
      siblingModels: ['Galaxy S25 Ultra', 'Galaxy S25 Plus'],
    });
    expect(result.accepted.map((a) => a.alias)).not.toContain('S25');
  });

  it('rejects aliases already owned by another slug', () => {
    const result = generateAliasCandidates({
      brand: 'Google',
      model: 'Pixel 9 Pro',
      slug: 'google-pixel-9-pro',
      existingAliases: [{ alias: 'Pixel 9 Pro', slug: 'google-pixel-9-pro-xl' }],
    });
    expect(result.rejected).toContainEqual({
      alias: 'Pixel 9 Pro',
      reason: 'alias_collision',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { TAGS, isValidTag } from './tags';

describe('public cache tags', () => {
  it('formats known static tags', () => {
    expect(TAGS.phones).toBe('phones');
    expect(TAGS.browse).toBe('browse');
    expect(TAGS.aspectDefinitions).toBe('aspect-definitions');
  });

  it('formats parametric tags', () => {
    expect(TAGS.phone('iphone-16')).toBe('phone:iphone-16');
    expect(TAGS.phone('PIXEL-9')).toBe('phone:pixel-9');
    expect(TAGS.scorecard('a0000000-0000-4000-8000-000000000001')).toBe(
      'scorecard:a0000000-0000-4000-8000-000000000001',
    );
  });

  it('validates whitelist tags correctly', () => {
    expect(isValidTag('phones')).toBe(true);
    expect(isValidTag('browse')).toBe(true);
    expect(isValidTag('aspect-definitions')).toBe(true);
    expect(isValidTag('phone:galaxy-s24')).toBe(true);
    expect(isValidTag('scorecard:a0000000-0000-4000-8000-000000000001')).toBe(true);

    // Invalid patterns
    expect(isValidTag('')).toBe(false);
    expect(isValidTag('unknown-tag')).toBe(false);
    expect(isValidTag('phone:')).toBe(false);
    expect(isValidTag('phone:with spaces')).toBe(false);
    expect(isValidTag('scorecard:not-a-uuid')).toBe(false);
    expect(isValidTag('a'.repeat(257))).toBe(false);
  });
});

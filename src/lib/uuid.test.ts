import { describe, expect, it } from 'vitest';
import { isValidUuid } from './uuid';

describe('isValidUuid', () => {
  it('returns true for valid standard UUIDs', () => {
    expect(isValidUuid('848320e9-257b-4b5d-b8e0-4bb47cc985f8')).toBe(true);
    expect(isValidUuid('00000000-0000-0000-0000-000000000000')).toBe(true);
    expect(isValidUuid('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')).toBe(true);
    expect(isValidUuid('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11')).toBe(true);
  });

  it('handles surrounding whitespace gracefully', () => {
    expect(isValidUuid('  848320e9-257b-4b5d-b8e0-4bb47cc985f8  ')).toBe(true);
  });

  it('returns false for invalid UUID strings', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false);
    expect(isValidUuid('1234567890')).toBe(false);
    expect(isValidUuid('848320e9-257b-4b5d-b8e0')).toBe(false);
    expect(isValidUuid('848320e9-257b-4b5d-b8e0-4bb47cc985f8-extra')).toBe(false);
    expect(isValidUuid('g48320e9-257b-4b5d-b8e0-4bb47cc985f8')).toBe(false); // non-hex character
    expect(isValidUuid('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(12345)).toBe(false);
    expect(isValidUuid({})).toBe(false);
    expect(isValidUuid([])).toBe(false);
  });
});

/**
 * Unit tests for USD formatting utility (`format-usd.ts`).
 *
 * Tests cover: valid numeric strings (integer, decimal), null/undefined
 * guard, empty-string guard, non-numeric string guard, and locale-correct
 * output format. Pure.
 */
import { describe, expect, it } from 'vitest';

import { formatUsdFromNumericString } from './format-usd';

describe('formatUsdFromNumericString', () => {
  it('formats an integer string as USD', () => {
    const result = formatUsdFromNumericString('999');
    expect(result).toMatch(/\$999/);
  });

  it('formats a decimal string as USD', () => {
    const result = formatUsdFromNumericString('1299.99');
    expect(result).toMatch(/\$1,299\.99/);
  });

  it('formats zero', () => {
    const result = formatUsdFromNumericString('0');
    expect(result).toMatch(/\$0/);
  });

  it('returns null for null input', () => {
    expect(formatUsdFromNumericString(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(formatUsdFromNumericString(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(formatUsdFromNumericString('')).toBeNull();
  });

  it('returns null for non-numeric string', () => {
    expect(formatUsdFromNumericString('NaN')).toBeNull();
    expect(formatUsdFromNumericString('abc')).toBeNull();
    expect(formatUsdFromNumericString('Infinity')).toBeNull();
  });

  it('handles large values', () => {
    const result = formatUsdFromNumericString('1500000');
    expect(result).toMatch(/\$1,500,000/);
  });
});

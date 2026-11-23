import { describe, expect, it } from 'vitest';
import {
  CurrencyConversionError,
  DEFAULT_EXCHANGE_RATES,
  convertFromUsd,
  normalizeToUsd,
} from './currency';

describe('Currency Normalization Engine (WP-01)', () => {
  it('passes USD amounts through without alteration', () => {
    expect(DEFAULT_EXCHANGE_RATES.rates.USD).toBe(1.0);
    expect(normalizeToUsd(799, 'USD')).toBe(799);
    expect(convertFromUsd(799, 'USD')).toBe(799);
  });

  it('normalizes INR to USD accurately', () => {
    const usd = normalizeToUsd(86500, 'INR');
    expect(usd).toBeCloseTo(1000, 1);
  });

  it('converts USD to INR accurately', () => {
    const inr = convertFromUsd(1000, 'INR');
    expect(inr).toBeCloseTo(86500, 1);
  });

  it('handles custom exchange rates', () => {
    const customRates = {
      base: 'USD' as const,
      rates: { USD: 1.0, EUR: 0.9, INR: 80.0 },
    };
    expect(normalizeToUsd(80000, 'INR', customRates)).toBe(1000);
    expect(convertFromUsd(1000, 'EUR', customRates)).toBe(900);
  });

  it('throws CurrencyConversionError for unknown currency', () => {
    expect(() => normalizeToUsd(100, 'XYZ')).toThrow(CurrencyConversionError);
    expect(() => convertFromUsd(100, 'XYZ')).toThrow(CurrencyConversionError);
  });

  it('handles non-finite amount gracefully', () => {
    expect(normalizeToUsd(NaN, 'USD')).toBe(0);
    expect(convertFromUsd(Infinity, 'INR')).toBe(0);
  });
});

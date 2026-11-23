/**
 * Currency conversion and normalization engine (Plan 31 WP-01).
 *
 * Normalizes multi-currency prices and budgets to USD for uniform comparison,
 * threshold evaluation, and flagship discount alignment.
 */

export interface ExchangeRates {
  readonly base: 'USD';
  readonly rates: Readonly<Record<string, number>>;
}

export const DEFAULT_EXCHANGE_RATES: ExchangeRates = {
  base: 'USD',
  rates: {
    USD: 1.0,
    EUR: 0.92,
    GBP: 0.79,
    INR: 86.5,
    CAD: 1.36,
    AUD: 1.52,
    JPY: 155.0,
  },
};

export class CurrencyConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CurrencyConversionError';
  }
}

/**
 * Normalizes an amount in any supported currency to USD.
 */
export function normalizeToUsd(
  amount: number,
  currency: string,
  rates: ExchangeRates = DEFAULT_EXCHANGE_RATES,
): number {
  if (!Number.isFinite(amount)) return 0;
  const curr = currency.trim().toUpperCase();
  if (curr === 'USD') return amount;
  const rate = rates.rates[curr];
  if (!rate || rate <= 0) {
    throw new CurrencyConversionError(`Unsupported or invalid currency code: ${currency}`);
  }
  return amount / rate;
}

/**
 * Converts a USD amount to a target currency.
 */
export function convertFromUsd(
  amountUsd: number,
  targetCurrency: string,
  rates: ExchangeRates = DEFAULT_EXCHANGE_RATES,
): number {
  if (!Number.isFinite(amountUsd)) return 0;
  const curr = targetCurrency.trim().toUpperCase();
  if (curr === 'USD') return amountUsd;
  const rate = rates.rates[curr];
  if (!rate || rate <= 0) {
    throw new CurrencyConversionError(`Unsupported or invalid currency code: ${targetCurrency}`);
  }
  return amountUsd * rate;
}

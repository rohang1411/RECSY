/**
 * Central region registry — add new regions here, nowhere else.
 * Each entry drives DB queries, LLM prompts, UI formatting, and middleware.
 */
export interface RegionConfig {
  readonly countryCode: string; // ISO 3166-1 alpha-2
  readonly currency: string; // ISO 4217
  readonly symbol: string; // Display symbol: '$', '₹'
  readonly locale: string; // BCP 47 locale for Intl.NumberFormat
  readonly label: string; // Display name: 'United States'
  readonly flag: string; // Emoji flag
  readonly budgetExampleMax: number; // Example budget used in recommender prompt
  readonly budgetExampleLabel: string; // Human label e.g. '₹50,000' or '$700'
  readonly searchPlaceholder: string; // Recommender textarea placeholder
}

export const REGIONS: Record<string, RegionConfig> = {
  US: {
    countryCode: 'US',
    currency: 'USD',
    symbol: '$',
    locale: 'en-US',
    label: 'United States',
    flag: '🇺🇸',
    budgetExampleMax: 700,
    budgetExampleLabel: '$700',
    searchPlaceholder: 'Great camera, under $700, long battery, not too heavy...',
  },
  IN: {
    countryCode: 'IN',
    currency: 'INR',
    symbol: '₹',
    locale: 'en-IN',
    label: 'India',
    flag: '🇮🇳',
    budgetExampleMax: 50000,
    budgetExampleLabel: '₹50,000',
    searchPlaceholder: 'Great camera, under ₹50,000, long battery, lightweight...',
  },
};

export const SUPPORTED_REGION_CODES = Object.keys(REGIONS) as string[];
export const DEFAULT_REGION_CODE = 'US';

export function getRegionConfig(code: string | null | undefined): RegionConfig {
  if (!code) return REGIONS[DEFAULT_REGION_CODE]!;
  const upper = code.toUpperCase();
  return REGIONS[upper] ?? REGIONS[DEFAULT_REGION_CODE]!;
}

export function isSupportedRegion(code: string | null | undefined): boolean {
  if (!code) return false;
  return code.toUpperCase() in REGIONS;
}

export const FALLBACK_RATES: Record<string, number> = {
  IN: 83.5,
};

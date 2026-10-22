import { env } from '@/env';
import type { BillingProductCode, CatalogProduct } from './types';

export const DEFAULT_TEST_PRICE_IDS: Record<BillingProductCode, string> = {
  pack_s: 'price_pack_s_test',
  pack_m: 'price_pack_m_test',
  pro_monthly: 'price_pro_monthly_test',
};

/**
 * Returns the immutable product catalogue with price IDs dynamically resolved
 * from environment configuration.
 *
 * Normative reference: Section 9.2 of plan 25.
 */
export function getCatalog(): readonly CatalogProduct[] {
  const pricePackS = env.STRIPE_PRICE_PACK_S || DEFAULT_TEST_PRICE_IDS.pack_s;
  const pricePackM = env.STRIPE_PRICE_PACK_M || DEFAULT_TEST_PRICE_IDS.pack_m;
  const priceProMonthly = env.STRIPE_PRICE_PRO_MONTHLY || DEFAULT_TEST_PRICE_IDS.pro_monthly;

  return [
    {
      code: 'pack_s',
      kind: 'one_time',
      name: 'Starter Pack',
      description: '25 high-precision recommendations or phone chats.',
      priceUsd: 3.0,
      priceMinor: 300,
      currency: 'usd',
      credits: 25,
      includedQueries: 0,
      priceId: pricePackS,
      features: [
        '25 permanent query credits',
        'Credits never expire',
        'Standard fast reasoning pipeline',
        'Full phone specs and aspect comparisons',
      ],
    },
    {
      code: 'pack_m',
      kind: 'one_time',
      name: 'Power Pack',
      description: '100 query credits for active smartphone buyers.',
      priceUsd: 9.0,
      priceMinor: 900,
      currency: 'usd',
      credits: 100,
      includedQueries: 0,
      priceId: pricePackM,
      badge: 'Best Value',
      features: [
        '100 permanent query credits ($0.09/query)',
        'Credits never expire',
        'Standard fast reasoning pipeline',
        'Full phone specs and aspect comparisons',
      ],
    },
    {
      code: 'pro_monthly',
      kind: 'subscription',
      name: 'RECSY Pro',
      description: 'Unlimited depth and server-side reasoning for enthusiasts and power shoppers.',
      priceUsd: 9.99,
      priceMinor: 999,
      currency: 'usd',
      credits: 0,
      includedQueries: 150,
      priceId: priceProMonthly,
      badge: 'Pro Tier',
      features: [
        '150 included queries every monthly period',
        'Deep reasoning mode (Gemini 2.5 Pro & DeepSeek-R1)',
        '2 parallel in-flight queries',
        'Conversation history synced across all your devices',
        'Cancel easily anytime in two clicks',
      ],
    },
  ];
}

export function getProductByCode(code: string): CatalogProduct | null {
  const catalog = getCatalog();
  return catalog.find((p) => p.code === code) ?? null;
}

export function getProductByPriceId(priceId: string): CatalogProduct | null {
  const catalog = getCatalog();
  return catalog.find((p) => p.priceId === priceId) ?? null;
}

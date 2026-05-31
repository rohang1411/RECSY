/**
 * Conservative official OEM URL resolver.
 *
 * Purpose: provide high-confidence official product URL guesses for brands
 * with stable public spec URL patterns. The OEM extractor still validates the
 * fetched page before anything is promoted.
 */
import { normalizeIdentityText, slugifyCatalogPart } from './identity';

export interface OemUrlCandidate {
  readonly url: string;
  readonly brand: string;
}

const BUILDERS: Record<string, (model: string) => string[]> = {
  apple: (model) => [`https://www.apple.com/${slugifyCatalogPart(model)}/specs/`],
  google: (model) => [
    `https://store.google.com/product/${slugifyCatalogPart(model).replace(/-/g, '_')}_specs`,
  ],
  nothing: (model) => [`https://nothing.tech/products/${slugifyCatalogPart(model)}`],
  samsung: (model) => {
    const slug = slugifyCatalogPart(stripBrandPrefix(model, 'Samsung'));
    return [
      `https://www.samsung.com/latin_en/smartphones/${slug}/specs/`,
      `https://www.samsung.com/us/smartphones/${slug}/`,
    ];
  },
};

export function resolveOemUrls(
  brand: string | null | undefined,
  model: string | null | undefined,
): OemUrlCandidate[] {
  if (!brand || !model) return [];
  const key = oemBuilderKey(brand);
  const builder = BUILDERS[key];
  if (!builder) return [];
  return builder(stripBrandPrefix(model, brand)).map((url) => ({ url, brand }));
}

export function hasOemUrlBuilder(brand: string | null | undefined): boolean {
  if (!brand) return false;
  return oemBuilderKey(brand) in BUILDERS;
}

function oemBuilderKey(brand: string): string {
  const normalized = normalizeIdentityText(brand);
  if (normalized.includes('nothing')) return 'nothing';
  if (normalized.includes('google') || normalized === 'pixel') return 'google';
  if (normalized.includes('samsung') || normalized === 'galaxy') return 'samsung';
  return normalized.replace(/\s+/g, '');
}

function stripBrandPrefix(model: string, brand: string): string {
  const normalizedBrand = normalizeIdentityText(brand);
  const normalizedModel = normalizeIdentityText(model);
  if (normalizedBrand === 'samsung' && normalizedModel.startsWith('samsung galaxy ')) {
    return model.replace(/^samsung\s+/i, '').trim();
  }
  if (normalizedBrand === 'google' && normalizedModel.startsWith('google pixel ')) {
    return model.replace(/^google\s+/i, '').trim();
  }
  if (normalizedBrand === 'apple' && normalizedModel.startsWith('apple iphone ')) {
    return model.replace(/^apple\s+/i, '').trim();
  }
  return model;
}

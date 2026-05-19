/**
 * Catalog brand prioritization.
 *
 * Purpose: prefer globally mainstream phone brands when a source returns more
 * candidates than we want to stage/promote in one run. This is deterministic
 * and makes no LLM calls.
 *
 * Used by: `scripts/catalog-sync-mobileapi.ts`.
 */
import { normalizeIdentityText } from './identity';

export interface BrandPriorityEntry {
  readonly company: string;
  readonly rank: number;
  readonly brands: readonly string[];
}

export const DEFAULT_MAINSTREAM_BRAND_PRIORITY: readonly BrandPriorityEntry[] = [
  { company: 'Apple', rank: 1, brands: ['Apple', 'iPhone'] },
  { company: 'Samsung', rank: 2, brands: ['Samsung'] },
  { company: 'Xiaomi', rank: 3, brands: ['Xiaomi', 'Redmi', 'Poco', 'POCO'] },
  { company: 'vivo', rank: 4, brands: ['vivo', 'iQOO'] },
  { company: 'OPPO', rank: 5, brands: ['OPPO', 'OnePlus', 'Realme'] },
  { company: 'Transsion', rank: 6, brands: ['Tecno', 'Infinix', 'itel', 'iTel'] },
  { company: 'Nothing', rank: 7, brands: ['Nothing', 'CMF by Nothing', 'CMF'] },
];

const BRAND_PRIORITY_BY_NORMALIZED_BRAND = new Map(
  DEFAULT_MAINSTREAM_BRAND_PRIORITY.flatMap((entry) =>
    entry.brands.map((brand) => [normalizeBrandForPriority(brand), entry.rank] as const),
  ),
);

export function brandPriorityRank(brand: string | null | undefined): number {
  if (!brand) return Number.MAX_SAFE_INTEGER;
  return (
    BRAND_PRIORITY_BY_NORMALIZED_BRAND.get(normalizeBrandForPriority(brand)) ??
    Number.MAX_SAFE_INTEGER
  );
}

export function isMainstreamPriorityBrand(brand: string | null | undefined): boolean {
  return brandPriorityRank(brand) !== Number.MAX_SAFE_INTEGER;
}

export function mainstreamPriorityBrandLabel(): string {
  return DEFAULT_MAINSTREAM_BRAND_PRIORITY.map((entry) => entry.company).join(', ');
}

function normalizeBrandForPriority(brand: string): string {
  return normalizeIdentityText(brand).replace(/\s+/g, '');
}

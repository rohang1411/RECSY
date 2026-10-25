/**
 * Brands cache (Plan 26 WP-07).
 *
 * Delegates to public-data.ts which uses Next.js unstable_cache tagged with 'phones'.
 */
import { getActiveBrands } from '@/services/cache/public-data';

export const getCachedBrands = getActiveBrands;

export function getCacheStats(): { hits: number; misses: number } {
  return { hits: 0, misses: 0 };
}

export function resetCacheStatsForTest(): void {}

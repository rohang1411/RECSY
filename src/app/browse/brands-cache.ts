import { asc, eq } from 'drizzle-orm';
import { getDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';

let cachedBrands: {
  readonly brands: readonly string[];
  readonly expiresAtMs: number;
} | null = null;

let hits = 0;
let misses = 0;

export function getCacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

export function resetCacheStatsForTest(): void {
  hits = 0;
  misses = 0;
  cachedBrands = null;
}

export async function getCachedBrands(): Promise<readonly string[]> {
  const now = Date.now();
  if (cachedBrands && now < cachedBrands.expiresAtMs) {
    hits++;
    return cachedBrands.brands;
  }
  misses++;
  const db = getDb();
  const brandRows = await db
    .select({ brand: phones.brand })
    .from(phones)
    .where(eq(phones.status, 'active'))
    .groupBy(phones.brand)
    .orderBy(asc(phones.brand));

  const brands = brandRows.map((r) => r.brand);
  cachedBrands = { brands, expiresAtMs: now + 3_600_000 };
  return brands;
}

/**
 * In-memory single-flight cache for recommendation catalog.
 *
 * Prevents redundant database queries and pooler egress spikes during repeated
 * recommendation turns, concurrent sessions, and scorecard/benchmark runs.
 *
 * Cold catalog read: ~0.88 MB transferred once (with separate phone/aspect queries).
 * Warm catalog read: 0 bytes transferred from Supabase.
 */
import { env } from '@/env';
import type { AppQueryDb } from '@/services/db/client';
import { withStatementTimeout } from '@/services/db/timeout';
import {
  loadRecommendationCatalog,
  type LoadCatalogOptions,
  type PhoneCatalogEntry,
} from './catalog';

const CATALOG_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  readonly entries: readonly PhoneCatalogEntry[];
  readonly expiresAt: number;
  readonly hasSpecEmb: boolean;
}

let hits = 0;
let misses = 0;
const lastObservedHasSpecEmb = new Map<string, boolean>();

export function getCacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

export function shouldEmbedForRegion(regionCode: string = 'US'): boolean {
  const reg = regionCode.trim().toUpperCase();
  return lastObservedHasSpecEmb.get(reg) ?? true;
}

export function resetCacheStatsForTest(): void {
  hits = 0;
  misses = 0;
  lastObservedHasSpecEmb.clear();
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<readonly PhoneCatalogEntry[]>>();

function buildCacheKey(regionCode: string, withSpecEmbeddings: boolean): string {
  const schema = env.DATABASE_SCHEMA ?? 'public';
  const reg = regionCode.trim().toUpperCase();
  const embFlag = withSpecEmbeddings ? 'emb' : 'noemb';
  return `${schema}:${reg}:${embFlag}`;
}

/**
 * Loads the recommendation catalog with single-flight promise coalescing and in-memory TTL caching.
 */
export async function getCachedRecommendationCatalog(
  db: AppQueryDb,
  regionCode: string = 'US',
  options: LoadCatalogOptions = {},
): Promise<readonly PhoneCatalogEntry[]> {
  const withEmbeddings = options.withSpecEmbeddings !== false;
  const key = buildCacheKey(regionCode, withEmbeddings);
  const now = Date.now();

  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) {
    hits++;
    return hit.entries;
  }

  misses++;

  // Coalesce in-flight fetches so concurrent requests share a single DB load
  let promise = inFlight.get(key);
  if (!promise) {
    promise = withStatementTimeout(db, '3s', (scopedDb) =>
      loadRecommendationCatalog(scopedDb, regionCode, options),
    )
      .then((entries) => {
        const reg = regionCode.trim().toUpperCase();
        const hasSpecEmb = entries.some((c) => c.specEmbedding && c.specEmbedding.length > 0);
        lastObservedHasSpecEmb.set(reg, hasSpecEmb);
        cache.set(key, {
          entries,
          expiresAt: Date.now() + CATALOG_CACHE_TTL_MS,
          hasSpecEmb,
        });
        return entries;
      })
      .finally(() => {
        inFlight.delete(key);
      });

    inFlight.set(key, promise);
  }

  return promise;
}

/**
 * Invalidate cached catalog entries for a specific region or all regions.
 */
export function invalidateRecommendationCatalogCache(regionCode?: string): void {
  if (regionCode) {
    const reg = regionCode.trim().toUpperCase();
    for (const key of cache.keys()) {
      if (key.includes(`:${reg}:`)) {
        cache.delete(key);
      }
    }
  } else {
    cache.clear();
  }
}

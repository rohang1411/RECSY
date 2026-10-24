/**
 * Aspect definitions cache (Plan 26 WP-05 & WP-07).
 *
 * Provides single-flight in-memory L1 cache with 10-minute TTL and delegates to
 * Next.js unstable_cache (tag: aspectDefinitions, revalidate: 3600) for cross-instance caching.
 */
import type { AppQueryDb } from '@/services/db/client';
import { aspectDefinitions } from '@/services/db/schema';
import { getAspectDefinitions } from '@/services/cache/public-data';
import type { AspectDefinitionRow } from '@/services/scorecard/types';

export type { AspectDefinitionRow };

const ASPECT_DEFS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface CacheEntry {
  readonly rows: readonly AspectDefinitionRow[];
  readonly expiresAt: number;
}

let cached: CacheEntry | null = null;
let inFlight: Promise<readonly AspectDefinitionRow[]> | null = null;
let hits = 0;
let misses = 0;

export function getAspectDefinitionsCacheStats(): { hits: number; misses: number } {
  return { hits, misses };
}

export function resetAspectDefinitionsCacheForTest(): void {
  cached = null;
  inFlight = null;
  hits = 0;
  misses = 0;
}

export function invalidateAspectDefinitionsCache(): void {
  cached = null;
  inFlight = null;
}

export async function getCachedAspectDefinitions(
  db?: AppQueryDb,
): Promise<readonly AspectDefinitionRow[]> {
  const now = Date.now();

  if (cached && now < cached.expiresAt) {
    hits++;
    return cached.rows;
  }

  misses++;

  if (!inFlight) {
    const fetcher: Promise<readonly AspectDefinitionRow[]> = db
      ? db.select().from(aspectDefinitions)
      : getAspectDefinitions();

    inFlight = fetcher
      .then((rows) => {
        cached = {
          rows,
          expiresAt: Date.now() + ASPECT_DEFS_CACHE_TTL_MS,
        };
        return rows;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  return inFlight;
}

/**
 * In-memory single-flight cache for aspect definitions.
 *
 * Prevents redundant database queries during recommendation pipeline runs.
 * Changes only when scoring methodology or aspect definitions change.
 */
import type { AppQueryDb } from '@/services/db/client';
import { aspectDefinitions } from '@/services/db/schema';

export type AspectDefinitionRow = typeof aspectDefinitions.$inferSelect;

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

export async function getCachedAspectDefinitions(
  db: AppQueryDb,
): Promise<readonly AspectDefinitionRow[]> {
  const now = Date.now();

  if (cached && now < cached.expiresAt) {
    hits++;
    return cached.rows;
  }

  misses++;

  if (!inFlight) {
    inFlight = db
      .select()
      .from(aspectDefinitions)
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

export function invalidateAspectDefinitionsCache(): void {
  cached = null;
  inFlight = null;
}

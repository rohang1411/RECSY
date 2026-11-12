/**
 * LRU sessionStorage cache for recommendation sessions (Plan 27 WP-07).
 *
 * Caches the last 10 viewed sessions under `recsy:rec:v2:<id>` to enable instant
 * paint on reload or session switch before network queries settle.
 */
import type { SessionDetail } from './api';

const CACHE_PREFIX = 'recsy:rec:v2:';
const LRU_INDEX_KEY = 'recsy:rec:v2:__index__';
const LEGACY_CACHE_KEY = 'recsy:session:recommend:v1';
const MAX_LRU_ENTRIES = 10;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function getLruIndex(): string[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.sessionStorage.getItem(LRU_INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function setLruIndex(index: string[]): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.setItem(LRU_INDEX_KEY, JSON.stringify(index));
  } catch {
    // Quota or storage disabled
  }
}

/**
 * Remove legacy `recsy:session:recommend:v1` cache on first load.
 */
export function cleanupLegacySessionCache(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(LEGACY_CACHE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Read a cached session from sessionStorage. Updates its position in the LRU index.
 */
export function readCachedSession(id: string): SessionDetail | null {
  if (!isBrowser() || !id) return null;
  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${id}`);
    if (!raw) return null;
    const session = JSON.parse(raw) as SessionDetail;
    if (!session || typeof session !== 'object' || session.id !== id) {
      return null;
    }

    // Move to front of LRU
    const index = getLruIndex();
    const updated = [id, ...index.filter((existingId) => existingId !== id)];
    setLruIndex(updated);

    return session;
  } catch {
    return null;
  }
}

/**
 * Persist a session into sessionStorage with LRU eviction of entries beyond the 10-item cap.
 */
export function writeCachedSession(session: SessionDetail): void {
  if (!isBrowser() || !session?.id) return;
  try {
    window.sessionStorage.setItem(`${CACHE_PREFIX}${session.id}`, JSON.stringify(session));

    const index = getLruIndex();
    const updated = [session.id, ...index.filter((id) => id !== session.id)];

    // Evict entries beyond MAX_LRU_ENTRIES
    while (updated.length > MAX_LRU_ENTRIES) {
      const evictedId = updated.pop();
      if (evictedId) {
        window.sessionStorage.removeItem(`${CACHE_PREFIX}${evictedId}`);
      }
    }

    setLruIndex(updated);
  } catch {
    // Storage quota exceeded or disabled
  }
}

/**
 * Remove a cached session by ID and prune it from the LRU index.
 */
export function removeCachedSession(id: string): void {
  if (!isBrowser() || !id) return;
  try {
    window.sessionStorage.removeItem(`${CACHE_PREFIX}${id}`);
    const index = getLruIndex();
    const updated = index.filter((existingId) => existingId !== id);
    setLruIndex(updated);
  } catch {
    // Ignore
  }
}

/**
 * Clear all cached recommendation sessions and reset the LRU index.
 */
export function clearAllCachedSessions(): void {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

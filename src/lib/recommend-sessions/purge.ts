/**
 * Client session state purge utility for sign-out and account hygiene (Plan 27 WP-07, WP-10).
 *
 * Ensures no cached prompts, conversation history, or draft messages remain
 * accessible in the browser after a user signs out or switches accounts.
 */
import type { QueryClient } from '@tanstack/react-query';
import { clearAllCachedSessions, cleanupLegacySessionCache } from './local-cache';
import { clearAllDrafts } from './drafts';
import { broadcastSessionChange } from './broadcast';

export interface PurgeOptions {
  queryClient?: QueryClient | null;
  ownerKey?: string;
  broadcast?: boolean;
}

/**
 * Purge all client-side recommendation session state, in-memory queries, drafts, and LRU cache.
 */
export function purgeClientSessionState(options: PurgeOptions = {}): void {
  const { queryClient, ownerKey, broadcast = true } = options;

  // 1. Clear React Query cache
  if (queryClient) {
    try {
      queryClient.clear();
    } catch {
      // Ignore
    }
  }

  // 2. Remove all sessionStorage v2 caches & drafts
  clearAllCachedSessions();
  clearAllDrafts();
  cleanupLegacySessionCache();

  // 3. Notify other tabs to clear their state
  if (broadcast) {
    broadcastSessionChange({
      type: 'signed-out',
      ownerKey,
    });
  }
}

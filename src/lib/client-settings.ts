/**
 * Client-side user settings backed by `localStorage`.
 *
 * Keep this module **tiny** and dependency-free — it runs on the first client
 * paint of every chat surface. Server components must never import from here.
 *
 * Design notes:
 * - We use a single namespaced prefix (`recsy:setting:`) so dev tools surface
 *   everything clearly and we avoid collisions with other libraries.
 * - Values are stringified JSON. A missing key (or invalid JSON) falls back
 *   to the provided default.
 * - Implemented via {@link useSyncExternalStore} so reading from
 *   `localStorage` during hydration happens in the store, not inside an
 *   effect. The server snapshot always returns the fallback, so React never
 *   sees a hydration mismatch — the value transitions to the stored one on
 *   the first committed client render.
 * - A cross-tab `storage` listener keeps all mounted hooks in sync, and a
 *   module-level emitter lets components in the same tab update together
 *   without a page reload.
 */

'use client';

import { useCallback, useSyncExternalStore } from 'react';

const PREFIX = 'recsy:setting:';

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

function emit(key: string): void {
  const set = listeners.get(key);
  if (!set) return;
  for (const l of set) l();
}

function subscribeKey(key: string, onChange: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onChange);

  const onStorage = (e: StorageEvent) => {
    if (e.key === PREFIX + key) onChange();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }

  return () => {
    set!.delete(onChange);
    if (set!.size === 0) listeners.delete(key);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

/**
 * Read-and-cache pattern: `useSyncExternalStore` requires the snapshot to be
 * referentially stable between renders when nothing changes. We cache the
 * last raw string seen in `localStorage` per key so repeated calls return
 * the same parsed reference (important for object/array settings).
 */
const snapshotCache = new Map<string, { raw: string | null; parsed: unknown }>();

function getSnapshot<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PREFIX + key);
  } catch {
    return fallback;
  }
  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) {
    return cached.parsed as T;
  }
  let parsed: T;
  if (raw == null) {
    parsed = fallback;
  } else {
    try {
      parsed = JSON.parse(raw) as T;
    } catch {
      parsed = fallback;
    }
  }
  snapshotCache.set(key, { raw, parsed });
  return parsed;
}

function getServerSnapshot<T>(fallback: T): T {
  return fallback;
}

function writeRaw<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — silently swallow; preference is
    // ephemeral and per-tab in that case.
  }
  snapshotCache.delete(key);
}

/**
 * Returns the current value and a setter that persists to `localStorage`
 * and notifies other hooks listening on the same key. SSR returns `fallback`
 * until first hydration to prevent hydration mismatches.
 */
export function useClientSetting<T>(key: string, fallback: T): [T, (next: T) => void] {
  const subscribe = useCallback(
    (onStoreChange: Listener) => subscribeKey(key, onStoreChange),
    [key],
  );
  const getClient = useCallback(() => getSnapshot<T>(key, fallback), [key, fallback]);
  const getServer = useCallback(() => getServerSnapshot<T>(fallback), [fallback]);

  const value = useSyncExternalStore(subscribe, getClient, getServer);

  const update = useCallback(
    (next: T) => {
      writeRaw(key, next);
      emit(key);
    },
    [key],
  );

  return [value, update];
}

/** Stable key list. Extend this when adding new user-visible settings. */
export const CLIENT_SETTING_KEYS = {
  /** When `true`, plain Enter submits the chat input (Shift+Enter = newline). */
  enterToSend: 'enterToSend',
} as const;

/** Default values. Kept co-located with the key list to avoid drift. */
export const CLIENT_SETTING_DEFAULTS = {
  [CLIENT_SETTING_KEYS.enterToSend]: true,
} as const;

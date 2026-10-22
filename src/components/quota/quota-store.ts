'use client';

import { useSyncExternalStore } from 'react';
import type { EntitlementSnapshot, QuotaSnapshotLite } from '@/services/metering/types';

export interface QuotaStoreState {
  readonly snapshot: EntitlementSnapshot | null;
  readonly loading: boolean;
  readonly lastUpdated: number;
  readonly stale: boolean;
  readonly pipFlash: 'pulse' | 'spent' | 'restored' | null;
}

const STORAGE_KEY = 'recsy:entitlement-cache';
const CHANNEL_NAME = 'recsy-quota';

let state: QuotaStoreState = {
  snapshot: null,
  loading: true,
  lastUpdated: 0,
  stale: true,
  pipFlash: null,
};

const listeners = new Set<() => void>();
let broadcastChannel: BroadcastChannel | null = null;

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function persistToStorage(snapshot: EntitlementSnapshot | null) {
  if (typeof window === 'undefined' || !snapshot) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadInitialSnapshotFromStorage(): EntitlementSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EntitlementSnapshot;
  } catch {
    return null;
  }
}

function initBroadcastChannel() {
  if (
    typeof window === 'undefined' ||
    broadcastChannel ||
    typeof BroadcastChannel === 'undefined'
  ) {
    return;
  }
  try {
    broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
    broadcastChannel.onmessage = (event) => {
      if (event.data?.type === 'snapshot_update' && event.data.snapshot) {
        state = {
          ...state,
          snapshot: event.data.snapshot,
          loading: false,
          lastUpdated: Date.now(),
          stale: false,
        };
        persistToStorage(event.data.snapshot);
        notify();
      }
    };
  } catch {
    // BroadcastChannel unsupported or blocked
  }
}

export const quotaStore = {
  getSnapshot(): QuotaStoreState {
    return state;
  },

  getServerSnapshot(): QuotaStoreState {
    return {
      snapshot: null,
      loading: true,
      lastUpdated: 0,
      stale: true,
      pipFlash: null,
    };
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    initBroadcastChannel();
    return () => {
      listeners.delete(listener);
    };
  },

  setSnapshot(snapshot: EntitlementSnapshot, isStale = false) {
    state = {
      ...state,
      snapshot,
      loading: false,
      lastUpdated: Date.now(),
      stale: isStale,
    };
    persistToStorage(snapshot);
    if (!isStale && broadcastChannel) {
      broadcastChannel.postMessage({ type: 'snapshot_update', snapshot });
    }
    notify();
  },

  updateFromQuotaLite(lite: QuotaSnapshotLite) {
    if (!state.snapshot) return;
    const current = state.snapshot;

    const nextFreeRemaining =
      typeof lite.freeRemaining === 'number' ? lite.freeRemaining : current.free.remaining;
    const nextFreeUsed = current.free.allowance - nextFreeRemaining;

    const nextCredits =
      typeof lite.creditBalance === 'number' ? lite.creditBalance : current.credits;

    let nextSub = current.subscription;
    if (nextSub && typeof lite.subRemaining === 'number') {
      nextSub = {
        ...nextSub,
        usedThisPeriod: nextSub.includedQueries - lite.subRemaining,
      };
    }

    const updated: EntitlementSnapshot = {
      ...current,
      free: {
        ...current.free,
        remaining: nextFreeRemaining,
        used: Math.max(0, nextFreeUsed),
      },
      credits: nextCredits,
      subscription: nextSub,
      resetAt: lite.resetAt || current.resetAt,
    };

    quotaStore.setSnapshot(updated, false);
  },

  setPipFlash(pipFlash: 'pulse' | 'spent' | 'restored' | null) {
    state = {
      ...state,
      pipFlash,
    };
    notify();
  },

  async refresh(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      const res = await fetch('/api/me/entitlements');
      if (res.ok) {
        const snap = (await res.json()) as EntitlementSnapshot;
        quotaStore.setSnapshot(snap, false);
      }
    } catch {
      // Ignore network errors on refresh
    }
  },
};

export function useQuota() {
  const storeState = useSyncExternalStore(
    quotaStore.subscribe,
    quotaStore.getSnapshot,
    quotaStore.getServerSnapshot,
  );
  const snap = storeState.snapshot;
  const isSubscriber = Boolean(
    snap?.subscription &&
    (snap.subscription.status === 'active' || snap.subscription.status === 'past_due'),
  );
  return {
    ...storeState,
    signedIn: snap?.signedIn ?? false,
    email: null,
    isSubscriber,
    freeRemaining: snap?.free.remaining ?? 2,
    freeAllowance: snap?.free.allowance ?? 2,
    credits: snap?.credits ?? 0,
    subRemaining: snap?.subscription
      ? Math.max(0, snap.subscription.includedQueries - snap.subscription.usedThisPeriod)
      : 0,
    resetAt: snap?.resetAt ?? '2099-01-01T00:00:00.000Z',
    refresh: () => quotaStore.refresh(),
  };
}

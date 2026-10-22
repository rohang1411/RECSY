'use client';

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
};

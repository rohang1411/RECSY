// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { quotaStore, loadInitialSnapshotFromStorage } from './quota-store';
import type { EntitlementSnapshot } from '@/services/metering/types';

describe('WP-15: quota-store state machine', () => {
  const mockSnapshot: EntitlementSnapshot = {
    signedIn: true,
    mode: 'enforce',
    free: {
      used: 0,
      allowance: 2,
      remaining: 2,
    },
    resetAt: new Date(Date.now() + 3600000).toISOString(),
    credits: 25,
    subscription: null,
    byok: {
      active: false,
      usedToday: 0,
      dailyCap: 100,
    },
    capacity: 'ok',
    nextSource: 'free',
    features: {
      signIn: true,
      billing: true,
    },
  };

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('updates snapshot and persists to sessionStorage', () => {
    quotaStore.setSnapshot(mockSnapshot);
    const state = quotaStore.getSnapshot();
    expect(state.snapshot).toEqual(mockSnapshot);
    expect(state.loading).toBe(false);

    const fromStorage = loadInitialSnapshotFromStorage();
    expect(fromStorage).toEqual(mockSnapshot);
  });

  it('updates quota from QuotaSnapshotLite event', () => {
    quotaStore.setSnapshot(mockSnapshot);
    quotaStore.updateFromQuotaLite({
      remaining: 1,
      freeRemaining: 1,
      creditBalance: 25,
      subRemaining: 0,
      resetAt: mockSnapshot.resetAt,
      chargeSource: 'daily_free',
      outcome: 'committed',
    });

    const updated = quotaStore.getSnapshot().snapshot;
    expect(updated?.free.remaining).toBe(1);
    expect(updated?.free.used).toBe(1);
  });

  it('sets and clears pip flash', () => {
    quotaStore.setPipFlash('pulse');
    expect(quotaStore.getSnapshot().pipFlash).toBe('pulse');

    quotaStore.setPipFlash(null);
    expect(quotaStore.getSnapshot().pipFlash).toBeNull();
  });
});

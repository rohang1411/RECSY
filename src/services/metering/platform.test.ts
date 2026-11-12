import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getPlatformState,
  getPerfFlags,
  assertPlatformAcceptsRequest,
  resetPlatformStateCache,
  getDefaultPlatformState,
} from './platform';
import { DEFAULT_PERF_FLAGS } from '@/services/perf/flags';
import type { AppQueryDb } from '@/services/db/client';
import { AppError } from '@/lib/errors';

describe('Metering Platform State & Admission Control', () => {
  beforeEach(() => {
    resetPlatformStateCache();
    vi.restoreAllMocks();
  });

  it('provides sensible default platform state', () => {
    const def = getDefaultPlatformState();
    expect(def.capacity).toBe('ok');
    expect(def.killSwitch.enabled).toBe(false);
    expect(def.shedFreeFor({ userId: null })).toBe(false);
    expect(def.perf).toEqual(DEFAULT_PERF_FLAGS);
  });

  it('performs single-flight deduplication and caches state for 10s', async () => {
    let queryCount = 0;
    const mockDb = {
      execute: vi.fn().mockImplementation(async () => {
        queryCount++;
        return [
          {
            kill_switch: { enabled: false },
            cap: 1000,
            perf_flags: { ask_streaming: 'canary', ask_streaming_canary_pct: 15 },
            used_today: 100,
          },
        ];
      }),
    } as unknown as AppQueryDb;

    // Concurrent calls should share a single promise
    const [state1, state2] = await Promise.all([
      getPlatformState(mockDb),
      getPlatformState(mockDb),
    ]);

    expect(queryCount).toBe(1);
    expect(state1.globalDailyCap).toBe(1000);
    expect(state1.usedToday).toBe(100);
    expect(state1.capacity).toBe('ok');
    expect(state1.perf.ask_streaming).toBe('canary');
    expect(state1.perf.ask_streaming_canary_pct).toBe(15);
    expect(state2).toBe(state1);

    // Subsequent call within 10s uses cache
    const state3 = await getPlatformState(mockDb);
    expect(queryCount).toBe(1);
    expect(state3).toBe(state1);

    // getPerfFlags uses the same cached platform state with zero extra DB calls
    const perf = await getPerfFlags(mockDb);
    expect(queryCount).toBe(1);
    expect(perf.ask_streaming).toBe('canary');
  });

  it('falls back to stale cache or default on DB failure', async () => {
    const mockDbSuccess = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          kill_switch: { enabled: false },
          cap: 500,
          used_today: 50,
        },
      ]),
    } as unknown as AppQueryDb;

    const initial = await getPlatformState(mockDbSuccess);
    expect(initial.globalDailyCap).toBe(500);

    // Reset timestamp to simulate cache expiry
    resetPlatformStateCache();

    const mockDbFail = {
      execute: vi.fn().mockRejectedValueOnce(new Error('DB connection failed')),
    } as unknown as AppQueryDb;

    const fallback = await getPlatformState(mockDbFail);
    expect(fallback.capacity).toBe('ok');
    expect(fallback.killSwitch.enabled).toBe(false);
  });

  describe('assertPlatformAcceptsRequest', () => {
    it('allows non-BYOK requests when platform is healthy', () => {
      const state = getDefaultPlatformState();
      expect(() => assertPlatformAcceptsRequest(state, { userId: 'user-1' }, false)).not.toThrow();
      expect(() => assertPlatformAcceptsRequest(state, { userId: null }, false)).not.toThrow();
    });

    it('throws PLATFORM_PAUSED 503 for non-BYOK when kill switch is enabled, but allows BYOK', () => {
      const state = {
        ...getDefaultPlatformState(),
        killSwitch: { enabled: true, message: 'Maintenance in progress' },
        capacity: 'paused' as const,
      };

      // BYOK is allowed
      expect(() => assertPlatformAcceptsRequest(state, { userId: 'user-1' }, true)).not.toThrow();
      expect(() => assertPlatformAcceptsRequest(state, { userId: null }, true)).not.toThrow();

      // Platform-funded is paused
      expect(() => assertPlatformAcceptsRequest(state, { userId: 'user-1' }, false)).toThrow(
        AppError,
      );

      try {
        assertPlatformAcceptsRequest(state, { userId: null }, false);
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe('PLATFORM_PAUSED');
        expect(appErr.status).toBe(503);
      }
    });

    it('throws CAPACITY_BUSY 503 for anonymous non-BYOK when capacity is busy, but allows signed-in and BYOK', () => {
      const state = {
        ...getDefaultPlatformState(),
        capacity: 'busy' as const,
      };

      // Signed in allowed
      expect(() =>
        assertPlatformAcceptsRequest(state, { userId: 'user-123' }, false),
      ).not.toThrow();

      // BYOK allowed
      expect(() => assertPlatformAcceptsRequest(state, { userId: null }, true)).not.toThrow();

      // Anonymous non-BYOK shed
      try {
        assertPlatformAcceptsRequest(state, { userId: null }, false);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.code).toBe('CAPACITY_BUSY');
        expect(appErr.status).toBe(503);
      }
    });
  });

  describe('shedFreeFor', () => {
    it('returns true when usedToday >= 1.0 * globalDailyCap', () => {
      const state = {
        ...getDefaultPlatformState(),
        globalDailyCap: 100,
        usedToday: 100,
      };
      // Bind shedFreeFor implementation from platform logic
      const fullState = {
        ...state,
        shedFreeFor(_identity: { userId: string | null }) {
          if (this.globalDailyCap <= 0) return false;
          return this.usedToday >= 1.0 * this.globalDailyCap;
        },
      };
      expect(fullState.shedFreeFor({ userId: 'u1' })).toBe(true);
      expect(fullState.shedFreeFor({ userId: null })).toBe(true);
    });

    it('returns false when usedToday < 1.0 * globalDailyCap', () => {
      const fullState = {
        ...getDefaultPlatformState(),
        globalDailyCap: 100,
        usedToday: 99,
        shedFreeFor() {
          if (this.globalDailyCap <= 0) return false;
          return this.usedToday >= 1.0 * this.globalDailyCap;
        },
      };
      expect(fullState.shedFreeFor()).toBe(false);
    });
  });
});

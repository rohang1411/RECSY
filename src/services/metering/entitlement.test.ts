import { describe, expect, it, vi } from 'vitest';
import { getEntitlementSnapshot } from './entitlement';
import { getMeteringConfig } from './config';
import { getDefaultPlatformState } from './platform';
import type { AppQueryDb } from '@/services/db/client';

describe('Entitlement Service', () => {
  const defaultPlatform = getDefaultPlatformState();

  it('returns static defaults on crawler / first paint with zero DB calls', async () => {
    const mockDb = { execute: vi.fn() } as unknown as AppQueryDb;
    const config = getMeteringConfig({ mode: 'enforce', anonDailyQueries: 2 });

    const snap1 = await getEntitlementSnapshot({
      db: mockDb,
      identity: null,
      config,
      platform: defaultPlatform,
    });
    expect(snap1.signedIn).toBe(false);
    expect(snap1.free.remaining).toBe(2);
    expect(snap1.nextSource).toBe('free');
    expect(mockDb.execute).not.toHaveBeenCalled();

    const snap2 = await getEntitlementSnapshot({
      db: mockDb,
      identity: { userId: null, deviceId: 'nocookie:hash123' },
      config,
      platform: defaultPlatform,
    });
    expect(snap2.signedIn).toBe(false);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('correctly derives free, subscription, and credit entitlements for signed-in viewer', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          user_free_used: 1,
          user_byok_used: 0,
          device_total_used: 1,
          device_anon_used: 0,
          device_byok_used: 0,
          credits: 10,
          subscription: {
            planCode: 'pro_monthly',
            status: 'active',
            included: 200,
            used: 50,
            periodEnd: new Date('2026-11-20T00:00:00.000Z'),
            cancelAtPeriodEnd: false,
            entitledUntil: new Date('2026-11-20T00:00:00.000Z'),
          },
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'enforce', freeDailyQueries: 2 });
    const snap = await getEntitlementSnapshot({
      db: mockDb,
      identity: { userId: 'user-uuid-1', deviceId: 'device-1' },
      config,
      platform: defaultPlatform,
    });

    expect(snap.signedIn).toBe(true);
    expect(snap.free.used).toBe(1);
    expect(snap.free.remaining).toBe(1);
    expect(snap.subscription).not.toBeNull();
    expect(snap.subscription?.includedQueries).toBe(200);
    expect(snap.subscription?.usedThisPeriod).toBe(50);
    expect(snap.credits).toBe(10);
    // free quota still has 1 query remaining, so nextSource is 'free'
    expect(snap.nextSource).toBe('free');
  });

  it('routes nextSource to subscription when free quota is exhausted', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          user_free_used: 2,
          user_byok_used: 0,
          device_total_used: 2,
          device_anon_used: 0,
          device_byok_used: 0,
          credits: 5,
          subscription: {
            planCode: 'pro_monthly',
            status: 'active',
            included: 200,
            used: 20,
            periodEnd: new Date('2026-11-20T00:00:00.000Z'),
            cancelAtPeriodEnd: false,
            entitledUntil: new Date('2026-11-20T00:00:00.000Z'),
          },
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'enforce', freeDailyQueries: 2 });
    const snap = await getEntitlementSnapshot({
      db: mockDb,
      identity: { userId: 'user-uuid-1', deviceId: 'device-1' },
      config,
      platform: defaultPlatform,
    });

    expect(snap.free.remaining).toBe(0);
    expect(snap.nextSource).toBe('subscription');
  });

  it('routes nextSource to credit when free and subscription are exhausted', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          user_free_used: 2,
          user_byok_used: 0,
          device_total_used: 2,
          device_anon_used: 0,
          device_byok_used: 0,
          credits: 5,
          subscription: null,
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'enforce', freeDailyQueries: 2 });
    const snap = await getEntitlementSnapshot({
      db: mockDb,
      identity: { userId: 'user-uuid-1', deviceId: 'device-1' },
      config,
      platform: defaultPlatform,
    });

    expect(snap.free.remaining).toBe(0);
    expect(snap.credits).toBe(5);
    expect(snap.nextSource).toBe('credit');
  });

  it('returns none when all sources are exhausted', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          user_free_used: 2,
          user_byok_used: 0,
          device_total_used: 2,
          device_anon_used: 0,
          device_byok_used: 0,
          credits: 0,
          subscription: null,
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'enforce', freeDailyQueries: 2 });
    const snap = await getEntitlementSnapshot({
      db: mockDb,
      identity: { userId: 'user-uuid-1', deviceId: 'device-1' },
      config,
      platform: defaultPlatform,
    });

    expect(snap.nextSource).toBe('none');
  });
});

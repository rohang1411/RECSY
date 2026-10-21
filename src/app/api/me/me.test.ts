import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { GET as getEntitlements } from './entitlements/route';
import { GET as getUsage } from './usage/route';
import { GET as getBilling } from './billing/route';
import { getDb } from '@/services/db/client';
import * as identityModule from '@/services/auth/identity';
import * as profileModule from '@/services/auth/profile';
import * as userRateLimitModule from '@/services/metering/rate-limit-user';
import * as deviceRateLimitModule from '@/services/abuse/rate-limit-device';
import * as entitlementService from '@/services/metering/entitlement';
import { UnauthorizedError, AccountRestrictedError } from '@/lib/errors';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/services/auth/identity');
vi.mock('@/services/auth/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof profileModule>();
  return {
    ...actual,
    requireUser: vi.fn(),
    getUserProfile: vi.fn(),
  };
});

vi.mock('@/services/metering/rate-limit-user');
vi.mock('@/services/abuse/rate-limit-device');
vi.mock('@/services/metering/entitlement', async (importOriginal) => {
  const actual = await importOriginal<typeof entitlementService>();
  return {
    ...actual,
    getEntitlementSnapshot: vi.fn(),
  };
});

describe('WP-10: /api/me/* Read APIs', () => {
  const mockDb = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    vi.mocked(userRateLimitModule.consumeUserRateLimit).mockResolvedValue(undefined);
    vi.mocked(deviceRateLimitModule.consumeDeviceRateLimit).mockResolvedValue(undefined);
  });

  describe('GET /api/me/entitlements', () => {
    it('fast path: returns static default for crawlers without calling DB', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: null,
        emailVerified: false,
        deviceId: 'nocookie:none',
        deviceCookieIsNew: true,
        ipKey: null,
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      const request = new NextRequest('http://localhost:3000/api/me/entitlements');
      const res = await getEntitlements(request);

      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(res.headers.get('etag')).toBeDefined();

      const json = await res.json();
      expect(json.signedIn).toBe(false);
      expect(json.free.allowance).toBe(2);
      expect(mockDb.execute).not.toHaveBeenCalled();
    });

    it('returns 304 Not Modified when client provides matching ETag', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: null,
        emailVerified: false,
        deviceId: 'nocookie:none',
        deviceCookieIsNew: true,
        ipKey: null,
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      const firstReq = new NextRequest('http://localhost:3000/api/me/entitlements');
      const firstRes = await getEntitlements(firstReq);
      const etag = firstRes.headers.get('etag');
      expect(etag).toBeDefined();

      const conditionalReq = new NextRequest('http://localhost:3000/api/me/entitlements', {
        headers: {
          'if-none-match': etag!,
        },
      });
      const secondRes = await getEntitlements(conditionalReq);

      expect(secondRes.status).toBe(304);
      expect(secondRes.headers.get('etag')).toBe(etag);
      expect(await secondRes.text()).toBe('');
    });

    it('returns 403 when identity is suspended', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: 'usr_suspended',
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: true,
      });

      const request = new NextRequest('http://localhost:3000/api/me/entitlements');
      const res = await getEntitlements(request);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('ACCOUNT_RESTRICTED');
    });

    it('authenticated user: loads profile and calls getEntitlementSnapshot', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: '00000000-0000-4000-8000-000000000001',
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      vi.mocked(profileModule.getUserProfile).mockResolvedValue({
        id: '00000000-0000-4000-8000-000000000001',
        email: 'user@example.com',
      } as unknown as profileModule.UserProfileRow);

      vi.mocked(entitlementService.getEntitlementSnapshot).mockResolvedValue({
        signedIn: true,
        mode: 'enforce',
        free: { used: 1, allowance: 2, remaining: 1 },
        resetAt: '2026-10-22T00:00:00.000Z',
        credits: 15,
        subscription: null,
        byok: { active: false, usedToday: 0, dailyCap: 100 },
        capacity: 'ok',
        nextSource: 'free',
        features: { signIn: true, billing: true },
      });

      const request = new NextRequest('http://localhost:3000/api/me/entitlements');
      const res = await getEntitlements(request);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.signedIn).toBe(true);
      expect(json.credits).toBe(15);
      expect(json.nextSource).toBe('free');
      expect(json.serverNow).toBeDefined();

      expect(userRateLimitModule.consumeUserRateLimit).toHaveBeenCalledWith(
        '00000000-0000-4000-8000-000000000001',
        'read',
        mockDb,
      );
      expect(deviceRateLimitModule.consumeDeviceRateLimit).toHaveBeenCalledWith(
        mockDb,
        'dev_123',
        'GET /api/me',
      );
    });
  });

  describe('GET /api/me/usage', () => {
    it('returns 401 UNAUTHORIZED when anonymous', async () => {
      vi.mocked(profileModule.requireUser).mockRejectedValue(
        new UnauthorizedError('Authentication required'),
      );

      const request = new NextRequest('http://localhost:3000/api/me/usage');
      const res = await getUsage(request);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 ACCOUNT_RESTRICTED when user is suspended', async () => {
      vi.mocked(profileModule.requireUser).mockRejectedValue(
        new AccountRestrictedError('Account restricted'),
      );

      const request = new NextRequest('http://localhost:3000/api/me/usage');
      const res = await getUsage(request);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('ACCOUNT_RESTRICTED');
    });

    it('returns usage daily rollups and recent <= 25 leases', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: '00000000-0000-4000-8000-000000000001',
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      mockDb.execute
        .mockResolvedValueOnce([
          { usage_date: '2026-10-20', charged: 2, not_charged: 1 },
          { usage_date: '2026-10-21', charged: 1, not_charged: 0 },
        ])
        .mockResolvedValueOnce([
          {
            id: '00000000-0000-4000-8000-000000000099',
            reserved_at: new Date('2026-10-21T10:00:00Z'),
            route: 'POST /api/recommend',
            status: 'committed',
            settle_reason: 'results',
            charge_source: 'daily_free',
          },
        ]);

      const request = new NextRequest('http://localhost:3000/api/me/usage?days=7');
      const res = await getUsage(request);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.days).toEqual([
        { date: '2026-10-20', charged: 2, notCharged: 1 },
        { date: '2026-10-21', charged: 1, notCharged: 0 },
      ]);
      expect(json.leases).toHaveLength(1);
      expect(json.leases[0]).toEqual({
        ref: '00000000-0000-4000-8000-000000000099',
        at: '2026-10-21T10:00:00.000Z',
        route: 'POST /api/recommend',
        outcome: 'committed',
        reason: 'results',
        source: 'daily_free',
      });
    });
  });

  describe('GET /api/me/billing', () => {
    it('returns 401 UNAUTHORIZED when anonymous', async () => {
      vi.mocked(profileModule.requireUser).mockRejectedValue(
        new UnauthorizedError('Authentication required'),
      );

      const request = new NextRequest('http://localhost:3000/api/me/billing');
      const res = await getBilling(request);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('returns credits, active subscription, orders, and ledger with pagination cursor', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: '00000000-0000-4000-8000-000000000001',
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      // 1. Wallet balance
      mockDb.execute.mockResolvedValueOnce([{ balance: 25 }]);

      // 2. Subscription
      mockDb.execute.mockResolvedValueOnce([
        {
          plan_code: 'pro_monthly',
          status: 'active',
          included_queries: 100,
          used: 12,
          current_period_end: new Date('2026-11-20T00:00:00Z'),
          cancel_at_period_end: false,
          entitled_until: new Date('2026-11-20T00:00:00Z'),
        },
      ]);

      // 3. Orders
      mockDb.execute.mockResolvedValueOnce([
        {
          id: 'ord_1',
          product_code: 'pack_50',
          amount_minor: 500,
          currency: 'usd',
          status: 'paid',
          created_at: new Date('2026-10-15T12:00:00Z'),
        },
      ]);

      // 4. Ledger
      mockDb.execute.mockResolvedValueOnce([
        {
          id: 'led_1',
          created_at: new Date('2026-10-21T14:00:00Z'),
          delta: -1,
          balance_after: 25,
          kind: 'usage',
          metadata: { description: 'Query usage charge' },
        },
      ]);

      const request = new NextRequest('http://localhost:3000/api/me/billing');
      const res = await getBilling(request);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.credits).toBe(25);
      expect(json.subscription).toEqual({
        planCode: 'pro_monthly',
        status: 'active',
        includedQueries: 100,
        usedThisPeriod: 12,
        periodEnd: '2026-11-20T00:00:00.000Z',
        cancelAtPeriodEnd: false,
        graceUntil: null,
      });
      expect(json.orders).toHaveLength(1);
      expect(json.orders[0].productCode).toBe('pack_50');
      expect(json.ledger).toHaveLength(1);
      expect(json.ledger[0].description).toBe('Query usage charge');
      expect(json.nextCursor).toBeNull();
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as getCatalogRoute } from './catalog/route';
import { POST as postCheckoutRoute } from './checkout/route';
import { POST as postPortalRoute } from './portal/route';
import { POST as postWebhookRoute } from './webhook/route';
import { getDb } from '@/services/db/client';
import * as profileModule from '@/services/auth/profile';
import type { RequestIdentity } from '@/services/auth/identity';
import { setBillingProviderForTest } from '@/services/billing/provider';
import { FakeBillingProvider } from '@/services/billing/fake-provider';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/services/auth/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof profileModule>();
  return {
    ...actual,
    requireUser: vi.fn(),
    getUserProfile: vi.fn(),
  };
});

vi.mock('@/lib/same-origin', () => ({
  assertSameOrigin: vi.fn(),
}));

describe('WP-14: Billing API Routes', () => {
  let fakeProvider: FakeBillingProvider;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  const mockIdentity = (userId: string): RequestIdentity => ({
    userId,
    emailVerified: true,
    deviceId: 'dev_test',
    deviceCookieIsNew: false,
    ipKey: null,
    ipHashForRateLimit: 'hash_test',
    isSuspended: false,
  });

  beforeEach(() => {
    fakeProvider = new FakeBillingProvider();
    setBillingProviderForTest(fakeProvider);

    mockDb = {
      execute: vi.fn(),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
    vi.clearAllMocks();
  });

  describe('GET /api/billing/catalog', () => {
    it('returns catalog products with cache headers', async () => {
      const response = await getCatalogRoute();
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.products).toHaveLength(3);
      expect(response.headers.get('Cache-Control')).toContain('public');
    });
  });

  describe('POST /api/billing/checkout', () => {
    it('creates checkout session for authenticated user and returns redirect URL', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      vi.mocked(profileModule.requireUser).mockResolvedValueOnce(mockIdentity(userId));
      vi.mocked(profileModule.getUserProfile).mockResolvedValueOnce({
        id: userId,
        email: 'test@example.com',
      } as unknown as profileModule.UserProfileRow);

      // 1. platform_flags paid_checkout_enabled -> not disabled
      mockDb.execute
        .mockResolvedValueOnce([])
        // 2. user profile status active, no billing hold
        .mockResolvedValueOnce([{ id: userId, status: 'active', billing_hold: false }])
        // 3. billing_customers lookup -> none
        .mockResolvedValueOnce([])
        // 4. insert billing_customers
        .mockResolvedValueOnce([])
        // 5. insert billing_orders pending
        .mockResolvedValueOnce([]);

      const request = new NextRequest('http://localhost:3000/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: 'pack_s' }),
      });

      const response = await postCheckoutRoute(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.url).toBeDefined();
      expect(data.checkoutId).toBeDefined();
    });

    it('returns 400 for invalid product code', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      vi.mocked(profileModule.requireUser).mockResolvedValueOnce(mockIdentity(userId));
      vi.mocked(profileModule.getUserProfile).mockResolvedValueOnce({
        id: userId,
        email: 'test@example.com',
      } as unknown as profileModule.UserProfileRow);

      const request = new NextRequest('http://localhost:3000/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productCode: 'invalid_pack' }),
      });

      const response = await postCheckoutRoute(request);
      expect(response.status).toBe(400);
    });
  });

  describe('POST /api/billing/portal', () => {
    it('returns customer portal URL for user with billing customer account', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      vi.mocked(profileModule.requireUser).mockResolvedValueOnce(mockIdentity(userId));

      mockDb.execute.mockResolvedValueOnce([{ provider_customer_id: 'fake_cus_1' }]);

      const request = new NextRequest('http://localhost:3000/api/billing/portal', {
        method: 'POST',
      });

      const response = await postPortalRoute(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.url).toContain('/account?portal=simulated');
    });

    it('returns 404 NO_BILLING_ACCOUNT when user has no customer record', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      vi.mocked(profileModule.requireUser).mockResolvedValueOnce(mockIdentity(userId));

      mockDb.execute.mockResolvedValueOnce([]);

      const request = new NextRequest('http://localhost:3000/api/billing/portal', {
        method: 'POST',
      });

      const response = await postPortalRoute(request);
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error.code).toBe('NO_BILLING_ACCOUNT');
    });
  });

  describe('POST /api/billing/webhook', () => {
    it('processes checkout.session.completed webhook and fulfils order', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const checkout = await fakeProvider.createCheckout({
        userId,
        email: 'user@example.com',
        providerCustomerId: null,
        product: {
          code: 'pack_s',
          kind: 'one_time',
          name: 'Starter Pack',
          description: '',
          priceUsd: 3,
          priceMinor: 300,
          currency: 'usd',
          credits: 25,
          includedQueries: 0,
          priceId: 'price_pack_s_test',
          features: [],
        },
        successUrl: 'http://localhost:3000/return?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'http://localhost:3000/pricing',
        idempotencyKey: 'webhook-test-key',
      });

      const payload = JSON.stringify({
        id: 'evt_webhook_1',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: checkout.checkoutId,
            client_reference_id: userId,
          },
        },
      });

      mockDb.execute
        // 1. claimBillingEvent: insert
        .mockResolvedValueOnce([{ id: 'row-evt-1', status: 'received', attempts: 0 }])
        // 2. claimBillingEvent: claim
        .mockResolvedValueOnce([{ id: 'row-evt-1', attempts: 1 }])
        // 3. check existing order
        .mockResolvedValueOnce([])
        // 4. upsert paid order
        .mockResolvedValueOnce([{ id: 'ord-wh-1', user_id: userId, credits: 25 }])
        // 5. recsy_apply_credit_delta
        .mockResolvedValueOnce([{ new_balance: 25, applied: true, ledger_entry_id: 'led-1' }])
        // 6. markEventProcessed
        .mockResolvedValueOnce([]);

      const request = new NextRequest('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'test_sig' },
        body: payload,
      });

      const response = await postWebhookRoute(request);
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.received).toBe(true);
    });

    it('rejects invalid signature with 400', async () => {
      const request = new NextRequest('http://localhost:3000/api/billing/webhook', {
        method: 'POST',
        headers: { 'stripe-signature': 'invalid_signature' },
        body: '{}',
      });

      const response = await postWebhookRoute(request);
      expect(response.status).toBe(400);
    });
  });
});

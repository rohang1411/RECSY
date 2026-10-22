import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getCatalog, getProductByCode, getProductByPriceId } from './catalog';
import { FakeBillingProvider } from './fake-provider';
import { claimBillingEvent } from './inbox';
import { fulfilCheckoutSession, applyRefund, applyDispute } from './fulfil';
import { syncSubscription } from './subscription-sync';
import { startPortal } from './checkout';
import { reconcileBilling } from './reconcile';
import type { AppQueryDb } from '@/services/db/client';

describe('WP-14: Billing Engine & Webhooks', () => {
  let fakeProvider: FakeBillingProvider;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    fakeProvider = new FakeBillingProvider();
    mockDb = {
      execute: vi.fn(),
    };
    vi.clearAllMocks();
  });

  describe('Catalog & Products', () => {
    it('returns all defined catalog products with correct credit allocations', () => {
      const catalog = getCatalog();
      expect(catalog).toHaveLength(3);

      const packS = getProductByCode('pack_s');
      expect(packS?.credits).toBe(25);
      expect(packS?.priceMinor).toBe(300);

      const packM = getProductByCode('pack_m');
      expect(packM?.credits).toBe(100);
      expect(packM?.priceMinor).toBe(900);

      const pro = getProductByCode('pro_monthly');
      expect(pro?.includedQueries).toBe(150);
      expect(pro?.kind).toBe('subscription');
    });

    it('finds products by price id', () => {
      const packS = getProductByCode('pack_s');
      expect(packS).toBeDefined();
      const found = getProductByPriceId(packS!.priceId);
      expect(found?.code).toBe('pack_s');
    });
  });

  describe('Webhook Signature & Inbox State Machine', () => {
    it('verifies valid webhook signature and extracts event', () => {
      const raw = JSON.stringify({
        id: 'evt_1',
        type: 'checkout.session.completed',
        data: { object: { id: 'fake_cs_123', client_reference_id: 'u1' } },
      });
      const event = fakeProvider.verifyWebhook(raw, 'valid_sig');
      expect(event.eventId).toBe('evt_1');
      expect(event.type).toBe('checkout.session.completed');
      expect(event.refs.checkoutId).toBe('fake_cs_123');
    });

    it('rejects invalid signature', () => {
      expect(() => fakeProvider.verifyWebhook('{}', 'invalid_signature')).toThrow();
    });

    it('claims new event successfully', async () => {
      mockDb.execute
        // 1. Insert row
        .mockResolvedValueOnce([{ id: 'row-1', status: 'received', attempts: 0 }])
        // 2. Claim row
        .mockResolvedValueOnce([{ id: 'row-1', attempts: 1 }]);

      const event = {
        provider: 'fake',
        eventId: 'evt_123',
        type: 'checkout.session.completed',
        livemode: false,
        createdAt: new Date(),
        refs: {},
      };

      const claim = await claimBillingEvent(event, mockDb as unknown as AppQueryDb);
      expect(claim.outcome).toBe('claimed');
      if (claim.outcome === 'claimed') {
        expect(claim.eventRowId).toBe('row-1');
      }
    });

    it('returns duplicate for already processed events', async () => {
      mockDb.execute.mockResolvedValueOnce([{ id: 'row-1', status: 'processed', attempts: 1 }]);

      const event = {
        provider: 'fake',
        eventId: 'evt_dup',
        type: 'checkout.session.completed',
        livemode: false,
        createdAt: new Date(),
        refs: {},
      };

      const claim = await claimBillingEvent(event, mockDb as unknown as AppQueryDb);
      expect(claim.outcome).toBe('duplicate');
    });
  });

  describe('Checkout Fulfilment (Pack Purchase)', () => {
    it('fulfils a paid checkout session and credits user wallet', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const checkout = await fakeProvider.createCheckout({
        userId,
        email: 'user@example.com',
        providerCustomerId: null,
        product: getProductByCode('pack_s')!,
        successUrl: 'http://localhost:3000/return?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'http://localhost:3000/pricing',
        idempotencyKey: 'test-key',
      });

      mockDb.execute
        // check existing order (no user mismatch)
        .mockResolvedValueOnce([])
        // upsert paid order
        .mockResolvedValueOnce([{ id: 'ord-123', user_id: userId, credits: 25 }])
        // recsy_apply_credit_delta
        .mockResolvedValueOnce([{ new_balance: 25, applied: true, ledger_entry_id: 'led-1' }]);

      const result = await fulfilCheckoutSession(
        checkout.checkoutId,
        fakeProvider,
        mockDb as unknown as AppQueryDb,
      );

      expect(result.fulfilled).toBe(true);
      expect(result.applied).toBe(true);
      expect(result.credits).toBe(25);
    });

    it('aborts and throws USER_MISMATCH if order belongs to a different user', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const checkout = await fakeProvider.createCheckout({
        userId,
        email: 'user@example.com',
        providerCustomerId: null,
        product: getProductByCode('pack_s')!,
        successUrl: 'http://localhost:3000/return?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'http://localhost:3000/pricing',
        idempotencyKey: 'test-key',
      });

      mockDb.execute
        // check existing order -> mismatch!
        .mockResolvedValueOnce([{ id: 'ord-1', user_id: '99999999-9999-9999-9999-999999999999' }]);

      await expect(
        fulfilCheckoutSession(checkout.checkoutId, fakeProvider, mockDb as unknown as AppQueryDb),
      ).rejects.toThrow('USER_MISMATCH');
    });
  });

  describe('Subscription Synchronisation', () => {
    it('syncs subscription and computes entitled_until through period end', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const subId = 'fake_sub_test';
      fakeProvider.seedSubscription({
        id: subId,
        customerId: 'cus_1',
        status: 'active',
        planCode: 'pro_monthly',
        priceId: getProductByCode('pro_monthly')!.priceId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        cancelAtPeriodEnd: false,
        metadata: { user_id: userId },
      });

      mockDb.execute.mockResolvedValueOnce([{ id: 'sub-row-1' }]);

      const result = await syncSubscription(subId, fakeProvider, mockDb as unknown as AppQueryDb);
      expect(result.synced).toBe(true);
      expect(result.subscriptionId).toBe('sub-row-1');
    });
  });

  describe('Refunds & Disputes', () => {
    it('applies proportional credit reversal on refund', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const chargeId = 'fake_ch_refund_1';
      fakeProvider.seedCharge({
        id: chargeId,
        amount: 300,
        amountRefunded: 300, // 100% refund
        refunded: true,
        paymentIntentId: 'pi_test_1',
        currency: 'usd',
        customer: 'cus_1',
        disputed: false,
      });

      mockDb.execute
        // find order
        .mockResolvedValueOnce([
          { id: 'ord-1', user_id: userId, credits: 25, amount_minor: 300, refunded_minor: 0 },
        ])
        // query already reversed
        .mockResolvedValueOnce([{ reversed: 0 }])
        // recsy_apply_credit_delta (-25)
        .mockResolvedValueOnce([{ new_balance: 0, applied: true, ledger_entry_id: 'led-rev-1' }])
        // update order status
        .mockResolvedValueOnce([]);

      const result = await applyRefund(chargeId, fakeProvider, mockDb as unknown as AppQueryDb);
      expect(result.refunded).toBe(true);
      expect(result.reversed).toBe(25);
    });

    it('sets billing_hold and reverses credits on dispute created', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      const chargeId = 'fake_ch_disp_1';
      fakeProvider.seedCharge({
        id: chargeId,
        amount: 300,
        amountRefunded: 0,
        refunded: false,
        paymentIntentId: 'pi_test_disp',
        currency: 'usd',
        customer: 'cus_1',
        disputed: true,
      });

      mockDb.execute
        // find order
        .mockResolvedValueOnce([{ id: 'ord-disp-1', user_id: userId, credits: 25 }])
        // update order to disputed
        .mockResolvedValueOnce([])
        // recsy_apply_credit_delta (-25)
        .mockResolvedValueOnce([{ new_balance: 0, applied: true }])
        // update user_profiles billing_hold = true
        .mockResolvedValueOnce([]);

      await applyDispute(
        'dp_123',
        chargeId,
        'created',
        fakeProvider,
        mockDb as unknown as AppQueryDb,
      );

      expect(mockDb.execute).toHaveBeenCalledTimes(4);
    });
  });

  describe('Customer Portal', () => {
    it('creates portal session for existing billing customer', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      mockDb.execute.mockResolvedValueOnce([{ provider_customer_id: 'fake_cus_1' }]);

      const portal = await startPortal(userId, mockDb as unknown as AppQueryDb);
      expect(portal.url).toContain('/account?portal=simulated');
    });

    it('throws NO_BILLING_ACCOUNT if user has no customer record', async () => {
      const userId = '22222222-2222-2222-2222-222222222222';
      mockDb.execute.mockResolvedValueOnce([]);

      await expect(startPortal(userId, mockDb as unknown as AppQueryDb)).rejects.toThrow();
    });
  });

  describe('Reconciliation', () => {
    it('finds and heals uncredited paid checkout session', async () => {
      const userId = '11111111-1111-1111-1111-111111111111';
      await fakeProvider.createCheckout({
        userId,
        email: 'user@example.com',
        providerCustomerId: null,
        product: getProductByCode('pack_s')!,
        successUrl: 'http://localhost:3000/return?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'http://localhost:3000/pricing',
        idempotencyKey: 'reconcile-test-key',
      });

      mockDb.execute
        // 1. Stuck events -> none
        .mockResolvedValueOnce([])
        // 2. Check if ledger row exists -> missing!
        .mockResolvedValueOnce([])
        // 3. Fulfill checkout session (check existing order)
        .mockResolvedValueOnce([])
        // 4. Upsert paid order
        .mockResolvedValueOnce([{ id: 'ord-rec-1', user_id: userId, credits: 25 }])
        // 5. recsy_apply_credit_delta
        .mockResolvedValueOnce([{ new_balance: 25, applied: true, ledger_entry_id: 'led-rec' }])
        // 6. Expired pending orders -> none
        .mockResolvedValueOnce([]);

      const result = await reconcileBilling(fakeProvider, mockDb as unknown as AppQueryDb);
      expect(result.fixedPurchases).toBe(1);
    });
  });
});

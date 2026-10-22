import type {
  BillingProvider,
  CatalogProduct,
  NormalizedBillingEvent,
  ProviderCharge,
  ProviderCheckout,
  ProviderSubscription,
} from './types';

export class FakeBillingProvider implements BillingProvider {
  readonly id = 'fake';

  private checkouts = new Map<string, ProviderCheckout>();
  private subscriptions = new Map<string, ProviderSubscription>();
  private charges = new Map<string, ProviderCharge>();
  private customers = new Map<string, string>(); // userId -> customerId

  async createCheckout(input: {
    userId: string;
    email: string;
    providerCustomerId: string | null;
    product: CatalogProduct;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ checkoutId: string; url: string; customerId: string }> {
    const customerId = input.providerCustomerId ?? `fake_cus_${input.userId}`;
    this.customers.set(input.userId, customerId);

    const checkoutId = `fake_cs_${crypto.randomUUID()}`;
    const mode = input.product.kind === 'subscription' ? 'subscription' : 'payment';
    const subscriptionId = mode === 'subscription' ? `fake_sub_${crypto.randomUUID()}` : null;
    const paymentIntentId = mode === 'payment' ? `fake_pi_${crypto.randomUUID()}` : null;

    const checkout: ProviderCheckout = {
      id: checkoutId,
      status: 'complete',
      paymentStatus: 'paid',
      mode,
      clientReferenceId: input.userId,
      customerId,
      subscriptionId,
      paymentIntentId,
      amountTotal: input.product.priceMinor,
      currency: input.product.currency,
      lineItems: [{ priceId: input.product.priceId, quantity: 1 }],
      metadata: {
        user_id: input.userId,
        product_code: input.product.code,
      },
      created: new Date(),
    };

    this.checkouts.set(checkoutId, checkout);

    if (mode === 'subscription' && subscriptionId) {
      this.subscriptions.set(subscriptionId, {
        id: subscriptionId,
        customerId,
        status: 'active',
        planCode: input.product.code,
        priceId: input.product.priceId,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
        cancelAtPeriodEnd: false,
        metadata: { user_id: input.userId },
      });
    }

    if (paymentIntentId) {
      const chargeId = `fake_ch_${crypto.randomUUID()}`;
      this.charges.set(chargeId, {
        id: chargeId,
        amount: input.product.priceMinor,
        amountRefunded: 0,
        refunded: false,
        paymentIntentId,
        currency: input.product.currency,
        customer: customerId,
        disputed: false,
      });
    }

    const returnSessionUrl = input.successUrl.replace('{CHECKOUT_SESSION_ID}', checkoutId);
    return {
      checkoutId,
      url: returnSessionUrl,
      customerId,
    };
  }

  async createPortalSession(input: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    return {
      url: `${input.returnUrl}?portal=simulated`,
    };
  }

  verifyWebhook(rawBody: string, signatureHeader: string): NormalizedBillingEvent {
    if (!signatureHeader || signatureHeader === 'invalid_signature') {
      throw new Error('Invalid signature header');
    }

    const parsed = JSON.parse(rawBody) as {
      id?: string;
      type?: string;
      livemode?: boolean;
      created?: number;
      data?: { object?: Record<string, unknown> };
    };

    const obj = parsed.data?.object ?? {};
    const eventType = parsed.type ?? 'unknown';

    const refs: NormalizedBillingEvent['refs'] = {
      checkoutId: typeof obj.id === 'string' && obj.id.startsWith('fake_cs_') ? obj.id : undefined,
      subscriptionId:
        typeof obj.subscription === 'string'
          ? obj.subscription
          : typeof obj.id === 'string' && obj.id.startsWith('fake_sub_')
            ? obj.id
            : undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : undefined,
      chargeId: typeof obj.charge === 'string' ? obj.charge : undefined,
    };

    return {
      provider: 'fake',
      eventId: parsed.id ?? `fake_evt_${crypto.randomUUID()}`,
      type: eventType,
      livemode: Boolean(parsed.livemode),
      createdAt: parsed.created ? new Date(parsed.created * 1000) : new Date(),
      refs,
    };
  }

  async fetchCheckout(checkoutId: string): Promise<ProviderCheckout> {
    const c = this.checkouts.get(checkoutId);
    if (!c) {
      throw new Error(`Checkout session ${checkoutId} not found in fake provider`);
    }
    return c;
  }

  async fetchSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const s = this.subscriptions.get(subscriptionId);
    if (!s) {
      throw new Error(`Subscription ${subscriptionId} not found in fake provider`);
    }
    return s;
  }

  async fetchCharge(chargeId: string): Promise<ProviderCharge> {
    const ch = this.charges.get(chargeId);
    if (!ch) {
      // Find charge by paymentIntentId or create on the fly
      for (const val of this.charges.values()) {
        if (val.id === chargeId || val.paymentIntentId === chargeId) return val;
      }
      throw new Error(`Charge ${chargeId} not found in fake provider`);
    }
    return ch;
  }

  async *listPaidCheckoutsSince(since: Date): AsyncIterable<ProviderCheckout> {
    for (const checkout of this.checkouts.values()) {
      if (checkout.paymentStatus === 'paid' && checkout.created >= since) {
        yield checkout;
      }
    }
  }

  async *listActiveSubscriptions(): AsyncIterable<ProviderSubscription> {
    for (const sub of this.subscriptions.values()) {
      if (sub.status === 'active' || sub.status === 'trialing') {
        yield sub;
      }
    }
  }

  // Test helpers to mutate in-memory state
  seedCheckout(checkout: ProviderCheckout): void {
    this.checkouts.set(checkout.id, checkout);
  }

  seedSubscription(subscription: ProviderSubscription): void {
    this.subscriptions.set(subscription.id, subscription);
  }

  seedCharge(charge: ProviderCharge): void {
    this.charges.set(charge.id, charge);
  }

  clear(): void {
    this.checkouts.clear();
    this.subscriptions.clear();
    this.charges.clear();
    this.customers.clear();
  }
}

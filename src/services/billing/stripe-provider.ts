import Stripe from 'stripe';
import { env } from '@/env';
import { logger } from '@/services/logger';
import type {
  BillingProvider,
  CatalogProduct,
  NormalizedBillingEvent,
  ProviderCharge,
  ProviderCheckout,
  ProviderSubscription,
} from './types';

const log = logger.child({ component: 'stripe-billing-provider' });

export class StripeBillingProvider implements BillingProvider {
  readonly id = 'stripe';
  private stripeClient: Stripe | null = null;

  private getStripe(): Stripe {
    if (!this.stripeClient) {
      if (!env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is not configured');
      }
      this.stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: env.STRIPE_API_VERSION as Stripe.LatestApiVersion,
        maxNetworkRetries: 2,
        timeout: 8000,
        appInfo: {
          name: 'recsy-v2',
          version: '0.1.0',
        },
      });
    }
    return this.stripeClient;
  }

  async createCheckout(input: {
    userId: string;
    email: string;
    providerCustomerId: string | null;
    product: CatalogProduct;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ checkoutId: string; url: string; customerId: string }> {
    const stripe = this.getStripe();
    const mode = input.product.kind === 'subscription' ? 'subscription' : 'payment';

    let customerId = input.providerCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create(
        {
          email: input.email,
          metadata: { user_id: input.userId },
        },
        {
          idempotencyKey: `cus_${input.userId}`,
        },
      );
      customerId = customer.id;
    }

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode,
      customer: customerId,
      client_reference_id: input.userId,
      line_items: [
        {
          price: input.product.priceId,
          quantity: 1,
        },
      ],
      metadata: {
        user_id: input.userId,
        product_code: input.product.code,
      },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
      locale: 'auto',
      allow_promotion_codes: false,
    };

    const session = await stripe.checkout.sessions.create(sessionParams, {
      idempotencyKey: input.idempotencyKey,
    });

    if (!session.url) {
      throw new Error('Stripe failed to return checkout session redirect URL');
    }

    return {
      checkoutId: session.id,
      url: session.url,
      customerId,
    };
  }

  async createPortalSession(input: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const stripe = this.getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: input.providerCustomerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  verifyWebhook(rawBody: string, signatureHeader: string): NormalizedBillingEvent {
    const stripe = this.getStripe();
    const secrets = (env.STRIPE_WEBHOOK_SECRET ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (secrets.length === 0) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    let event: Stripe.Event | null = null;
    let lastErr: Error | null = null;

    for (const secret of secrets) {
      try {
        event = stripe.webhooks.constructEvent(rawBody, signatureHeader, secret, 300);
        break;
      } catch (err) {
        lastErr = err as Error;
      }
    }

    if (!event) {
      log.warn({ err: lastErr }, 'Stripe webhook signature verification failed');
      throw lastErr ?? new Error('Invalid webhook signature');
    }

    const obj = event.data.object as unknown as Record<string, unknown>;

    const refs: NormalizedBillingEvent['refs'] = {
      checkoutId: typeof obj.id === 'string' && obj.id.startsWith('cs_') ? obj.id : undefined,
      subscriptionId:
        typeof obj.subscription === 'string'
          ? obj.subscription
          : typeof obj.id === 'string' && obj.id.startsWith('sub_')
            ? obj.id
            : undefined,
      customerId: typeof obj.customer === 'string' ? obj.customer : undefined,
      paymentIntentId:
        typeof obj.payment_intent === 'string'
          ? obj.payment_intent
          : typeof obj.id === 'string' && obj.id.startsWith('pi_')
            ? obj.id
            : undefined,
      chargeId:
        typeof obj.charge === 'string'
          ? obj.charge
          : typeof obj.id === 'string' && obj.id.startsWith('ch_')
            ? obj.id
            : undefined,
      invoiceId:
        typeof obj.invoice === 'string'
          ? obj.invoice
          : typeof obj.id === 'string' && obj.id.startsWith('in_')
            ? obj.id
            : undefined,
    };

    return {
      provider: 'stripe',
      eventId: event.id,
      type: event.type,
      livemode: event.livemode,
      createdAt: new Date(event.created * 1000),
      refs,
    };
  }

  async fetchCheckout(checkoutId: string): Promise<ProviderCheckout> {
    const stripe = this.getStripe();
    const s = await stripe.checkout.sessions.retrieve(checkoutId, {
      expand: ['line_items'],
    });

    const lineItems: Array<{ priceId: string; quantity: number }> = [];
    if (s.line_items?.data) {
      for (const item of s.line_items.data) {
        if (item.price?.id) {
          lineItems.push({
            priceId: item.price.id,
            quantity: item.quantity ?? 1,
          });
        }
      }
    }

    const paymentStatus: ProviderCheckout['paymentStatus'] =
      s.payment_status === 'paid'
        ? 'paid'
        : s.payment_status === 'no_payment_required'
          ? 'no_payment_required'
          : 'unpaid';

    return {
      id: s.id,
      status: s.status === 'complete' ? 'complete' : s.status === 'expired' ? 'expired' : 'open',
      paymentStatus,
      mode: s.mode === 'subscription' ? 'subscription' : 'payment',
      clientReferenceId: s.client_reference_id ?? null,
      customerId: typeof s.customer === 'string' ? s.customer : null,
      subscriptionId: typeof s.subscription === 'string' ? s.subscription : null,
      paymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : null,
      amountTotal: s.amount_total ?? 0,
      currency: s.currency ?? 'usd',
      lineItems,
      metadata: (s.metadata as Record<string, string>) ?? {},
      created: new Date(s.created * 1000),
    };
  }

  async fetchSubscription(subscriptionId: string): Promise<ProviderSubscription> {
    const stripe = this.getStripe();
    const sub = await stripe.subscriptions.retrieve(subscriptionId);

    const priceId = sub.items.data[0]?.price.id ?? '';
    const subRecord = sub as unknown as Record<string, unknown>;
    const firstItem = sub.items.data[0] as unknown as Record<string, unknown> | undefined;
    const periodStartSec =
      (firstItem?.current_period_start as number | undefined) ??
      (subRecord.current_period_start as number | undefined) ??
      0;
    const periodEndSec =
      (firstItem?.current_period_end as number | undefined) ??
      (subRecord.current_period_end as number | undefined) ??
      0;
    const currentPeriodStart = new Date(periodStartSec * 1000);
    const currentPeriodEnd = new Date(periodEndSec * 1000);

    let status: ProviderSubscription['status'] = 'unpaid';
    if (sub.status === 'active') status = 'active';
    else if (sub.status === 'trialing') status = 'trialing';
    else if (sub.status === 'past_due') status = 'past_due';
    else if (sub.status === 'canceled') status = 'canceled';
    else if (sub.status === 'paused') status = 'paused';
    else if (sub.status === 'incomplete') status = 'incomplete';
    else if (sub.status === 'incomplete_expired') status = 'incomplete_expired';

    return {
      id: sub.id,
      customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
      status,
      planCode: sub.metadata.product_code ?? 'pro_monthly',
      priceId,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      metadata: (sub.metadata as Record<string, string>) ?? {},
      latestInvoiceId: typeof sub.latest_invoice === 'string' ? sub.latest_invoice : undefined,
    };
  }

  async fetchCharge(chargeId: string): Promise<ProviderCharge> {
    const stripe = this.getStripe();
    const ch = await stripe.charges.retrieve(chargeId);

    return {
      id: ch.id,
      amount: ch.amount,
      amountRefunded: ch.amount_refunded,
      refunded: ch.refunded,
      paymentIntentId: typeof ch.payment_intent === 'string' ? ch.payment_intent : null,
      currency: ch.currency,
      customer: typeof ch.customer === 'string' ? ch.customer : null,
      disputed: ch.disputed,
      disputeId:
        typeof (ch as unknown as Record<string, unknown>).dispute === 'string'
          ? ((ch as unknown as Record<string, unknown>).dispute as string)
          : undefined,
    };
  }

  async *listPaidCheckoutsSince(since: Date): AsyncIterable<ProviderCheckout> {
    const stripe = this.getStripe();
    const sinceTimestamp = Math.floor(since.getTime() / 1000);

    const iterator = stripe.checkout.sessions.list({
      created: { gte: sinceTimestamp },
      limit: 100,
      expand: ['data.line_items'],
    });

    for await (const s of iterator) {
      if (s.payment_status === 'paid') {
        const lineItems = (s.line_items?.data ?? []).map((i) => ({
          priceId: i.price?.id ?? '',
          quantity: i.quantity ?? 1,
        }));

        yield {
          id: s.id,
          status: 'complete',
          paymentStatus: 'paid',
          mode: s.mode === 'subscription' ? 'subscription' : 'payment',
          clientReferenceId: s.client_reference_id ?? null,
          customerId: typeof s.customer === 'string' ? s.customer : null,
          subscriptionId: typeof s.subscription === 'string' ? s.subscription : null,
          paymentIntentId: typeof s.payment_intent === 'string' ? s.payment_intent : null,
          amountTotal: s.amount_total ?? 0,
          currency: s.currency ?? 'usd',
          lineItems,
          metadata: (s.metadata as Record<string, string>) ?? {},
          created: new Date(s.created * 1000),
        };
      }
    }
  }

  async *listActiveSubscriptions(): AsyncIterable<ProviderSubscription> {
    const stripe = this.getStripe();
    const iterator = stripe.subscriptions.list({
      status: 'active',
      limit: 100,
    });

    for await (const sub of iterator) {
      const priceId = sub.items.data[0]?.price.id ?? '';
      const subRecord = sub as unknown as Record<string, unknown>;
      const firstItem = sub.items.data[0] as unknown as Record<string, unknown> | undefined;
      const periodStartSec =
        (firstItem?.current_period_start as number | undefined) ??
        (subRecord.current_period_start as number | undefined) ??
        0;
      const periodEndSec =
        (firstItem?.current_period_end as number | undefined) ??
        (subRecord.current_period_end as number | undefined) ??
        0;
      const currentPeriodStart = new Date(periodStartSec * 1000);
      const currentPeriodEnd = new Date(periodEndSec * 1000);

      yield {
        id: sub.id,
        customerId: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        status: 'active',
        planCode: sub.metadata.product_code ?? 'pro_monthly',
        priceId,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        metadata: (sub.metadata as Record<string, string>) ?? {},
      };
    }
  }
}

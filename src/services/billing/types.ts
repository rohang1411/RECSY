/**
 * Billing Provider and Domain Types.
 * Normative reference: Section 9.2, 9.3 of plan 25.
 */

export type BillingProductCode = 'pack_s' | 'pack_m' | 'pro_monthly';

export interface CatalogProduct {
  readonly code: BillingProductCode;
  readonly kind: 'one_time' | 'subscription';
  readonly name: string;
  readonly description: string;
  readonly priceUsd: number;
  readonly priceMinor: number;
  readonly currency: string;
  readonly credits: number; // For one-time packs
  readonly includedQueries: number; // For subscriptions
  readonly priceId: string;
  readonly badge?: string;
  readonly features: readonly string[];
}

export interface ProviderCheckout {
  readonly id: string;
  readonly status: 'complete' | 'expired' | 'open';
  readonly paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  readonly mode: 'payment' | 'subscription';
  readonly clientReferenceId: string | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly paymentIntentId: string | null;
  readonly amountTotal: number;
  readonly currency: string;
  readonly lineItems: ReadonlyArray<{ priceId: string; quantity: number }>;
  readonly metadata: Readonly<Record<string, string>>;
  readonly created: Date;
}

export interface ProviderSubscription {
  readonly id: string;
  readonly customerId: string;
  readonly status:
    | 'active'
    | 'trialing'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'incomplete'
    | 'incomplete_expired'
    | 'paused';
  readonly planCode: string;
  readonly priceId: string;
  readonly currentPeriodStart: Date;
  readonly currentPeriodEnd: Date;
  readonly cancelAtPeriodEnd: boolean;
  readonly metadata: Readonly<Record<string, string>>;
  readonly latestInvoiceId?: string;
}

export interface ProviderCharge {
  readonly id: string;
  readonly amount: number;
  readonly amountRefunded: number;
  readonly refunded: boolean;
  readonly paymentIntentId: string | null;
  readonly currency: string;
  readonly customer: string | null;
  readonly disputed: boolean;
  readonly disputeId?: string;
}

export interface NormalizedBillingEvent {
  readonly provider: string;
  readonly eventId: string;
  readonly type: string;
  readonly livemode: boolean;
  readonly createdAt: Date;
  readonly refs: {
    readonly checkoutId?: string;
    readonly subscriptionId?: string;
    readonly customerId?: string;
    readonly invoiceId?: string;
    readonly chargeId?: string;
    readonly paymentIntentId?: string;
    readonly refundId?: string;
    readonly disputeId?: string;
  };
}

export interface BillingProvider {
  readonly id: 'stripe' | 'fake' | string;

  createCheckout(input: {
    userId: string;
    email: string;
    providerCustomerId: string | null;
    product: CatalogProduct;
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ checkoutId: string; url: string; customerId: string }>;

  createPortalSession(input: {
    providerCustomerId: string;
    returnUrl: string;
  }): Promise<{ url: string }>;

  /** Throws error on invalid signature. Never trusts the body before verification. */
  verifyWebhook(rawBody: string, signatureHeader: string): NormalizedBillingEvent;

  fetchCheckout(checkoutId: string): Promise<ProviderCheckout>;
  fetchSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  fetchCharge(chargeId: string): Promise<ProviderCharge>;

  listPaidCheckoutsSince(since: Date): AsyncIterable<ProviderCheckout>;
  listActiveSubscriptions(): AsyncIterable<ProviderSubscription>;
}

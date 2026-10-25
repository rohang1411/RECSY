import { env } from '@/env';
import type { BillingProvider } from './types';
import { StripeBillingProvider } from './stripe-provider';
import { FakeBillingProvider } from './fake-provider';

let billingProviderInstance: BillingProvider | null = null;
let fakeProviderInstance: FakeBillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (billingProviderInstance) {
    return billingProviderInstance;
  }

  // Security guard (SEC-04): Prevent fake billing fallback in production when billing is enabled
  if (env.NODE_ENV === 'production' && env.BILLING_ENABLED) {
    if (env.BILLING_PROVIDER === 'fake') {
      throw new Error(
        'BILLING_PROVIDER cannot be set to "fake" in production when BILLING_ENABLED is true',
      );
    }
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error(
        'STRIPE_SECRET_KEY must be configured in production when BILLING_ENABLED is true',
      );
    }
  }

  if (env.BILLING_PROVIDER === 'fake' || !env.STRIPE_SECRET_KEY) {
    if (!fakeProviderInstance) {
      fakeProviderInstance = new FakeBillingProvider();
    }
    billingProviderInstance = fakeProviderInstance;
    return billingProviderInstance;
  }

  billingProviderInstance = new StripeBillingProvider();
  return billingProviderInstance;
}

export function getFakeBillingProvider(): FakeBillingProvider {
  if (!fakeProviderInstance) {
    fakeProviderInstance = new FakeBillingProvider();
  }
  return fakeProviderInstance;
}

export function setBillingProviderForTest(provider: BillingProvider | null): void {
  billingProviderInstance = provider;
}

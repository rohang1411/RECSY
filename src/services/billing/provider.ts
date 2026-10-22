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

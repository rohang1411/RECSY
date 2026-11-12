import { sql } from 'drizzle-orm';
import { env } from '@/env';
import { AppError } from '@/lib/errors';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { getBillingProvider } from './provider';
import { FakeBillingProvider } from './fake-provider';
import { getProductByCode } from './catalog';
import type { BillingProductCode } from './types';

const log = logger.child({ component: 'billing-checkout' });

export function isEmailAllowlisted(email: string): boolean {
  const allowlistRaw = env.BILLING_ALLOWLIST_EMAILS;
  if (!allowlistRaw || allowlistRaw.trim() === '') {
    return true; // No allowlist restriction
  }

  const emails = allowlistRaw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return emails.includes(email.trim().toLowerCase());
}

/**
 * Initiates hosted checkout for credit packs or subscriptions.
 * Normative reference: Section 9.4.1 of plan 25.
 */
export async function startCheckout(
  userId: string,
  email: string,
  productCode: BillingProductCode,
  dbClient?: AppQueryDb,
  siteUrlOverride?: string,
): Promise<{ url: string; checkoutId: string }> {
  const db = dbClient ?? getDb();
  const provider = getBillingProvider();

  // 1. Guard: Billing enabled & allowlist
  const billingEnabled = env.BILLING_ENABLED || provider instanceof FakeBillingProvider;
  if (!billingEnabled) {
    throw new AppError('BILLING_NOT_AVAILABLE', 'Billing is currently disabled.', { status: 403 });
  }

  if (!isEmailAllowlisted(email)) {
    throw new AppError(
      'BILLING_NOT_AVAILABLE',
      'Billing is currently in private preview for invited accounts.',
      { status: 403 },
    );
  }

  // 2. Guard: Platform flags
  const flagRows = await db.execute<{ value: unknown }>(sql`
    SELECT value FROM platform_flags WHERE key = 'paid_checkout_enabled';
  `);
  if (flagRows[0]) {
    const val = flagRows[0].value as Record<string, unknown> | null;
    if (val && val.enabled === false) {
      throw new AppError('BILLING_NOT_AVAILABLE', 'Checkout is temporarily disabled.', {
        status: 403,
      });
    }
  }

  // 3. Guard: User profile active & no billing hold
  const userRows = await db.execute<{
    id: string;
    status: string;
    billing_hold: boolean;
  }>(sql`
    SELECT id, status, billing_hold
    FROM user_profiles
    WHERE id = ${userId}::uuid
    LIMIT 1;
  `);

  const profile = userRows[0];
  if (!profile || profile.status !== 'active' || profile.billing_hold) {
    throw new AppError(
      'ACCOUNT_RESTRICTED',
      'Your account is currently restricted from making purchases.',
      { status: 403 },
    );
  }

  // 4. Guard: Product exists
  const product = getProductByCode(productCode);
  if (!product) {
    throw new AppError('VALIDATION', `Unknown product code: ${productCode}`, { status: 400 });
  }

  // 5. Guard for pro_monthly: Prevent duplicate subscription
  if (product.kind === 'subscription') {
    const subRows = await db.execute<{ id: string; entitled_until: string | Date }>(sql`
      SELECT id, entitled_until
      FROM subscriptions
      WHERE user_id = ${userId}::uuid
        AND status IN ('active', 'trialing')
        AND entitled_until > now()
      LIMIT 1;
    `);

    if (subRows[0]) {
      throw new AppError(
        'ALREADY_SUBSCRIBED',
        'You already have an active RECSY Pro subscription.',
        {
          status: 409,
          context: {
            portalUrl: '/api/billing/portal',
          },
        },
      );
    }
  }

  // 6. Resolve Customer ID
  const custRows = await db.execute<{ provider_customer_id: string }>(sql`
    SELECT provider_customer_id
    FROM billing_customers
    WHERE user_id = ${userId}::uuid
      AND provider = ${provider.id}
    LIMIT 1;
  `);

  const existingCustomerId = custRows[0]?.provider_customer_id ?? null;

  // 7. Stable 5-minute idempotency key bucket
  const timeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const idempotencyKey = `checkout:${userId}:${productCode}:${timeBucket}`;

  const siteUrl = (siteUrlOverride || env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  const successUrl = `${siteUrl}/account/billing/return?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${siteUrl}/pricing?checkout=canceled`;

  const checkout = await provider.createCheckout({
    userId,
    email,
    providerCustomerId: existingCustomerId,
    product,
    successUrl,
    cancelUrl,
    idempotencyKey,
  });

  // 8. Persist customer ID if newly created
  if (checkout.customerId && checkout.customerId !== existingCustomerId) {
    await db.execute(sql`
      INSERT INTO billing_customers (user_id, provider, provider_customer_id)
      VALUES (${userId}::uuid, ${provider.id}, ${checkout.customerId})
      ON CONFLICT (user_id, provider) DO UPDATE SET
        provider_customer_id = EXCLUDED.provider_customer_id;
    `);
  }

  // 9. Pre-insert pending order for packs
  if (product.kind === 'one_time') {
    await db.execute(sql`
      INSERT INTO billing_orders (
        user_id,
        provider,
        provider_checkout_id,
        product_code,
        amount_minor,
        currency,
        status,
        credits
      )
      VALUES (
        ${userId}::uuid,
        ${provider.id},
        ${checkout.checkoutId},
        ${product.code},
        ${product.priceMinor},
        ${product.currency},
        'pending',
        ${product.credits}
      )
      ON CONFLICT (provider, provider_checkout_id) DO NOTHING;
    `);
  }

  log.info(
    { userId, productCode, checkoutId: checkout.checkoutId },
    'hosted checkout session created',
  );

  return {
    url: checkout.url,
    checkoutId: checkout.checkoutId,
  };
}

/**
 * Creates customer portal session for managing payment methods, invoices, and subscriptions.
 * Normative reference: Section 9.4.2 of plan 25.
 */
export async function startPortal(
  userId: string,
  dbClient?: AppQueryDb,
  siteUrlOverride?: string,
): Promise<{ url: string }> {
  const db = dbClient ?? getDb();
  const provider = getBillingProvider();

  const custRows = await db.execute<{ provider_customer_id: string }>(sql`
    SELECT provider_customer_id
    FROM billing_customers
    WHERE user_id = ${userId}::uuid
      AND provider = ${provider.id}
    LIMIT 1;
  `);

  const customerId = custRows[0]?.provider_customer_id;
  if (!customerId) {
    throw new AppError(
      'NO_BILLING_ACCOUNT',
      'No active billing customer found. Make a purchase first.',
      { status: 404 },
    );
  }

  const siteUrl = (siteUrlOverride || env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
    /\/$/,
    '',
  );
  const returnUrl = `${siteUrl}/account`;

  const portal = await provider.createPortalSession({
    providerCustomerId: customerId,
    returnUrl,
  });

  return { url: portal.url };
}

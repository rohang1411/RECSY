import { sql } from 'drizzle-orm';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import type { BillingProvider } from './types';
import { getBillingProvider } from './provider';
import { getProductByPriceId } from './catalog';
import { applyCreditDelta } from './entitlement-write';
import { syncSubscription } from './subscription-sync';

const log = logger.child({ component: 'billing-fulfil' });

export interface FulfilCheckoutResult {
  readonly fulfilled: boolean;
  readonly applied?: boolean;
  readonly credits?: number;
  readonly orderId?: string;
  readonly subscriptionId?: string;
  readonly status?: string;
}

/**
 * Idempotently fulfils a checkout session (packs and subscriptions).
 * Safe to run multiple times concurrently.
 *
 * Normative reference: Section 9.4.3 of plan 25.
 */
export async function fulfilCheckoutSession(
  checkoutId: string,
  providerParam?: BillingProvider,
  dbClient?: AppQueryDb,
): Promise<FulfilCheckoutResult> {
  const provider = providerParam ?? getBillingProvider();
  const db = dbClient ?? getDb();

  // 1. Fetch latest checkout object from provider with line items expanded
  const s = await provider.fetchCheckout(checkoutId);

  // 2. Subscriptions delegate to syncSubscription
  if (s.mode === 'subscription') {
    if (!s.subscriptionId) {
      throw new Error(
        `Checkout session ${checkoutId} is mode subscription but has no subscriptionId`,
      );
    }
    const syncResult = await syncSubscription(s.subscriptionId, provider, db);
    return {
      fulfilled: true,
      subscriptionId: syncResult.subscriptionId,
      status: 'active',
    };
  }

  // 3. Verify single product line item for one-time credit packs
  if (s.lineItems.length !== 1 || s.lineItems[0]!.quantity !== 1) {
    throw new Error(
      `Invalid checkout line items for ${checkoutId}: expected 1 item with quantity 1`,
    );
  }

  const lineItem = s.lineItems[0]!;
  const product = getProductByPriceId(lineItem.priceId);
  if (!product) {
    log.error({ priceId: lineItem.priceId, checkoutId }, 'unknown price id in checkout session');
    throw new Error(`Unknown price ID: ${lineItem.priceId}`);
  }

  // 4. Validate clientReferenceId user ID
  const userId = s.clientReferenceId;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    throw new Error(`Invalid or missing clientReferenceId on checkout session: ${userId}`);
  }

  // 5. If not paid yet, record pending order
  if (s.paymentStatus !== 'paid') {
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
        ${s.id},
        ${product.code},
        ${s.amountTotal},
        ${s.currency},
        'pending',
        ${product.credits}
      )
      ON CONFLICT (provider, provider_checkout_id) DO NOTHING;
    `);
    return { fulfilled: false, status: 'pending' };
  }

  // 6. Check existing order for tampering or user mismatch canary
  const existingRows = await db.execute<{ id: string; user_id: string }>(sql`
    SELECT id, user_id
    FROM billing_orders
    WHERE provider = ${provider.id}
      AND provider_checkout_id = ${s.id}
    LIMIT 1;
  `);

  if (existingRows[0] && existingRows[0].user_id !== userId) {
    log.error(
      {
        existingUserId: existingRows[0].user_id,
        sessionUserId: userId,
        checkoutId: s.id,
      },
      'CRITICAL: USER_MISMATCH detected in checkout fulfillment',
    );
    throw new Error(
      `USER_MISMATCH: order user ${existingRows[0].user_id} does not match session ${userId}`,
    );
  }

  // 7. Upsert paid order record
  const orderRows = await db.execute<{ id: string; user_id: string; credits: number }>(sql`
    INSERT INTO billing_orders (
      user_id,
      provider,
      provider_checkout_id,
      provider_payment_id,
      product_code,
      amount_minor,
      currency,
      status,
      credits,
      paid_at
    )
    VALUES (
      ${userId}::uuid,
      ${provider.id},
      ${s.id},
      ${s.paymentIntentId},
      ${product.code},
      ${s.amountTotal},
      ${s.currency},
      'paid',
      ${product.credits},
      now()
    )
    ON CONFLICT (provider, provider_checkout_id)
    DO UPDATE SET
      status = 'paid',
      paid_at = COALESCE(billing_orders.paid_at, now()),
      provider_payment_id = EXCLUDED.provider_payment_id,
      updated_at = now()
    RETURNING id, user_id, credits;
  `);

  const order = orderRows[0];
  if (!order) {
    throw new Error(`Failed to insert or update billing order for checkout ${s.id}`);
  }

  // 8. Apply credits atomically and idempotently via recsy_apply_credit_delta
  const creditResult = await applyCreditDelta(
    order.user_id,
    order.credits,
    'purchase',
    'order',
    order.id,
    `purchase:${s.id}`,
    {
      product: product.code,
      checkout_id: s.id,
      amount_minor: s.amountTotal,
      currency: s.currency,
    },
    db,
  );

  log.info(
    {
      userId: order.user_id,
      orderId: order.id,
      credits: order.credits,
      applied: creditResult.applied,
      newBalance: creditResult.newBalance,
    },
    'pack purchase fulfilled successfully',
  );

  return {
    fulfilled: true,
    applied: creditResult.applied,
    credits: order.credits,
    orderId: order.id,
    status: 'paid',
  };
}

/**
 * Reverses credits proportionally on partial or full charge refund.
 * Normative reference: Section 9.6 of plan 25.
 */
export async function applyRefund(
  chargeId: string,
  providerParam?: BillingProvider,
  dbClient?: AppQueryDb,
): Promise<{ refunded: boolean; reversed: number }> {
  const provider = providerParam ?? getBillingProvider();
  const db = dbClient ?? getDb();

  const charge = await provider.fetchCharge(chargeId);

  // Look up order by payment intent or charge ID
  const orderRows = await db.execute<{
    id: string;
    user_id: string;
    credits: number;
    amount_minor: number;
    refunded_minor: number;
  }>(sql`
    SELECT id, user_id, credits, amount_minor, refunded_minor
    FROM billing_orders
    WHERE provider = ${provider.id}
      AND (
        provider_payment_id = ${charge.paymentIntentId ?? charge.id}
        OR provider_payment_id = ${charge.id}
      )
    LIMIT 1;
  `);

  const order = orderRows[0];
  if (!order) {
    log.info(
      { chargeId },
      'no order found for refunded charge; ignoring (likely subscription invoice)',
    );
    return { refunded: false, reversed: 0 };
  }

  const refundedMinor = charge.amountRefunded;
  const targetReversed = Math.floor((order.credits * refundedMinor) / order.amount_minor);

  // Query already reversed credits for this order
  const revRows = await db.execute<{ reversed: string | number }>(sql`
    SELECT COALESCE(SUM(ABS(delta)), 0) AS reversed
    FROM credit_ledger
    WHERE user_id = ${order.user_id}::uuid
      AND reason = 'payment_reversal'
      AND ref_type = 'order'
      AND ref_id = ${order.id}::text;
  `);

  const alreadyReversed = Number(revRows[0]?.reversed ?? 0);
  const deltaToReverse = targetReversed - alreadyReversed;

  if (deltaToReverse > 0) {
    await applyCreditDelta(
      order.user_id,
      -deltaToReverse,
      'payment_reversal',
      'order',
      order.id,
      `reversal:${order.id}:${targetReversed}`,
      {
        refunded_minor: refundedMinor,
        charge_id: charge.id,
      },
      db,
    );
  }

  const newStatus = charge.refunded ? 'refunded' : 'partially_refunded';
  await db.execute(sql`
    UPDATE billing_orders
    SET
      status = ${newStatus},
      refunded_minor = ${refundedMinor},
      updated_at = now()
    WHERE id = ${order.id}::uuid;
  `);

  log.info(
    { orderId: order.id, userId: order.user_id, deltaToReverse, newStatus },
    'refund applied successfully',
  );

  return { refunded: true, reversed: deltaToReverse };
}

/**
 * Handles dispute lifecycle: created, won, lost.
 * Normative reference: Section 9.6 of plan 25.
 */
export async function applyDispute(
  disputeId: string,
  chargeId: string,
  disputeStatus: 'created' | 'won' | 'lost',
  providerParam?: BillingProvider,
  dbClient?: AppQueryDb,
): Promise<void> {
  const provider = providerParam ?? getBillingProvider();
  const db = dbClient ?? getDb();

  const charge = await provider.fetchCharge(chargeId);

  const orderRows = await db.execute<{ id: string; user_id: string; credits: number }>(sql`
    SELECT id, user_id, credits
    FROM billing_orders
    WHERE provider = ${provider.id}
      AND (
        provider_payment_id = ${charge.paymentIntentId ?? charge.id}
        OR provider_payment_id = ${charge.id}
      )
    LIMIT 1;
  `);

  const order = orderRows[0];

  if (disputeStatus === 'created') {
    if (order) {
      await db.execute(sql`
        UPDATE billing_orders
        SET status = 'disputed', updated_at = now()
        WHERE id = ${order.id}::uuid;
      `);

      await applyCreditDelta(
        order.user_id,
        -order.credits,
        'dispute',
        'dispute',
        disputeId,
        `dispute:${disputeId}`,
        { charge_id: chargeId },
        db,
      );

      await db.execute(sql`
        UPDATE user_profiles
        SET billing_hold = true, updated_at = now()
        WHERE id = ${order.user_id}::uuid;
      `);
    }
  } else if (disputeStatus === 'won') {
    if (order) {
      await db.execute(sql`
        UPDATE billing_orders
        SET status = 'paid', updated_at = now()
        WHERE id = ${order.id}::uuid;
      `);

      await applyCreditDelta(
        order.user_id,
        order.credits,
        'dispute_reversal',
        'dispute',
        disputeId,
        `dispute_won:${disputeId}`,
        { charge_id: chargeId },
        db,
      );

      await db.execute(sql`
        UPDATE user_profiles
        SET billing_hold = false, updated_at = now()
        WHERE id = ${order.user_id}::uuid;
      `);
    }
  } else if (disputeStatus === 'lost') {
    if (order) {
      await db.execute(sql`
        UPDATE billing_orders
        SET status = 'refunded', updated_at = now()
        WHERE id = ${order.id}::uuid;
      `);
    }
  }
}

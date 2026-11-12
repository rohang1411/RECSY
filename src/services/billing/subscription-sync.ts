import { sql } from 'drizzle-orm';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import type { BillingProvider } from './types';
import { getBillingProvider } from './provider';
import { getProductByPriceId, getProductByCode } from './catalog';

const log = logger.child({ component: 'subscription-sync' });

const PAST_DUE_GRACE_DAYS = 3;

/**
 * Synchronizes subscription state from the provider to the local `subscriptions` table.
 * Normative reference: Section 9.4.5 of plan 25.
 */
export async function syncSubscription(
  providerSubscriptionId: string,
  providerParam?: BillingProvider,
  dbClient?: AppQueryDb,
): Promise<{ synced: boolean; subscriptionId?: string }> {
  const provider = providerParam ?? getBillingProvider();
  const db = dbClient ?? getDb();

  const sub = await provider.fetchSubscription(providerSubscriptionId);

  // 1. Resolve User ID
  let userId: string | null = null;
  if (sub.metadata.user_id && /^[0-9a-f-]{36}$/i.test(sub.metadata.user_id)) {
    userId = sub.metadata.user_id;
  }

  if (!userId) {
    const custRows = await db.execute<{ user_id: string }>(sql`
      SELECT user_id
      FROM billing_customers
      WHERE provider = ${provider.id}
        AND provider_customer_id = ${sub.customerId}
      LIMIT 1;
    `);
    if (custRows[0]) {
      userId = custRows[0].user_id;
    }
  }

  if (!userId) {
    log.error(
      { providerSubscriptionId, customerId: sub.customerId },
      'cannot sync subscription: unresolved user id',
    );
    throw new Error(`Unresolved user id for subscription ${providerSubscriptionId}`);
  }

  // 2. Resolve Product metadata
  const product = getProductByPriceId(sub.priceId) ?? getProductByCode(sub.planCode);
  const planCode = product?.code ?? sub.planCode ?? 'pro_monthly';
  const includedQueries = product?.includedQueries ?? 150;

  // 3. Compute entitled_until according to Section 9.4.5
  const now = new Date();
  let entitledUntil: Date;

  if (sub.status === 'active' || sub.status === 'trialing') {
    entitledUntil = sub.currentPeriodEnd;
  } else if (sub.status === 'past_due') {
    const graceEnd = new Date(sub.currentPeriodStart.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000);
    entitledUntil = sub.currentPeriodEnd < graceEnd ? sub.currentPeriodEnd : graceEnd;
  } else if (sub.status === 'canceled') {
    entitledUntil = now < sub.currentPeriodEnd ? now : sub.currentPeriodEnd;
  } else {
    // 'unpaid', 'incomplete', 'incomplete_expired', 'paused'
    entitledUntil = now;
  }

  const fetchTimestamp = new Date();

  // 4. Atomic upsert with monotonic provider_event_at guard
  const upsertRows = await db.execute<{ id: string }>(sql`
    INSERT INTO subscriptions (
      user_id,
      provider,
      provider_subscription_id,
      plan_code,
      status,
      included_queries,
      current_period_start,
      current_period_end,
      entitled_until,
      cancel_at_period_end,
      provider_event_at
    )
    VALUES (
      ${userId}::uuid,
      ${provider.id},
      ${sub.id},
      ${planCode},
      ${sub.status},
      ${includedQueries},
      ${sub.currentPeriodStart.toISOString()}::timestamptz,
      ${sub.currentPeriodEnd.toISOString()}::timestamptz,
      ${entitledUntil.toISOString()}::timestamptz,
      ${sub.cancelAtPeriodEnd},
      ${fetchTimestamp.toISOString()}::timestamptz
    )
    ON CONFLICT (provider, provider_subscription_id)
    DO UPDATE SET
      status = EXCLUDED.status,
      plan_code = EXCLUDED.plan_code,
      included_queries = EXCLUDED.included_queries,
      current_period_start = EXCLUDED.current_period_start,
      current_period_end = EXCLUDED.current_period_end,
      entitled_until = EXCLUDED.entitled_until,
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      provider_event_at = EXCLUDED.provider_event_at,
      updated_at = now()
    WHERE subscriptions.provider_event_at <= EXCLUDED.provider_event_at
    RETURNING id;
  `);

  const subscriptionId = upsertRows[0]?.id;

  log.info(
    {
      userId,
      providerSubscriptionId: sub.id,
      status: sub.status,
      entitledUntil: entitledUntil.toISOString(),
    },
    'subscription synced successfully',
  );

  return { synced: true, subscriptionId };
}

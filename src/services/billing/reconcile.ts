import { sql } from 'drizzle-orm';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { getBillingProvider } from './provider';
import type { BillingProvider } from './types';
import { fulfilCheckoutSession } from './fulfil';
import { syncSubscription } from './subscription-sync';

const log = logger.child({ component: 'billing-reconcile' });

export interface ReconcileResult {
  readonly fixedPurchases: number;
  readonly syncedSubscriptions: number;
  readonly abandonedOrdersMarkedFailed: number;
  readonly redrivenEvents: number;
}

/**
 * Sweeps provider and database state to heal any dropped webhooks or desynchronised entitlements.
 * Normative reference: Section 9.8 of plan 25.
 */
export async function reconcileBilling(
  providerParam?: BillingProvider,
  dbClient?: AppQueryDb,
): Promise<ReconcileResult> {
  const provider = providerParam ?? getBillingProvider();
  const db = dbClient ?? getDb();

  let fixedPurchases = 0;
  let syncedSubscriptions = 0;
  let abandonedOrdersMarkedFailed = 0;
  let redrivenEvents = 0;

  // 1. Re-drive failed or stuck inbox events older than 2 minutes
  const stuckEvents = await db.execute<{
    id: string;
    provider: string;
    refs: Record<string, unknown>;
  }>(sql`
    SELECT id, provider, refs
    FROM billing_events
    WHERE status IN ('received', 'failed')
       OR (status = 'processing' AND (locked_until IS NULL OR locked_until < now() - interval '2 minutes'))
    ORDER BY received_at ASC
    LIMIT 100;
  `);

  for (const row of stuckEvents) {
    try {
      const checkoutId = typeof row.refs.checkoutId === 'string' ? row.refs.checkoutId : null;
      const subscriptionId =
        typeof row.refs.subscriptionId === 'string' ? row.refs.subscriptionId : null;

      if (checkoutId) {
        await fulfilCheckoutSession(checkoutId, provider, db);
        redrivenEvents++;
      } else if (subscriptionId) {
        await syncSubscription(subscriptionId, provider, db);
        redrivenEvents++;
      }

      await db.execute(sql`
        UPDATE billing_events
        SET status = 'processed', processed_at = now(), locked_until = NULL, error = NULL
        WHERE id = ${row.id}::uuid;
      `);
    } catch (err) {
      log.warn({ err, eventId: row.id }, 'failed to redrive billing event');
    }
  }

  // 2. Check provider checkouts since 72 hours ago
  const since72h = new Date(Date.now() - 72 * 3600 * 1000);
  try {
    for await (const checkout of provider.listPaidCheckoutsSince(since72h)) {
      if (checkout.mode === 'payment' && checkout.paymentStatus === 'paid') {
        const idemKey = `purchase:${checkout.id}`;
        const existing = await db.execute<{ id: string }>(sql`
          SELECT id FROM credit_ledger WHERE idempotency_key = ${idemKey} LIMIT 1;
        `);

        if (!existing[0]) {
          log.warn(
            { checkoutId: checkout.id },
            'reconciliation: found uncredited paid checkout; fulfilling',
          );
          await fulfilCheckoutSession(checkout.id, provider, db);
          fixedPurchases++;
        }
      }
    }
  } catch (err) {
    log.error({ err }, 'error during checkouts reconciliation sweep');
  }

  // 3. Sync active subscriptions from provider
  try {
    for await (const sub of provider.listActiveSubscriptions()) {
      const existing = await db.execute<{ id: string; provider_event_at: string | Date }>(sql`
        SELECT id, provider_event_at
        FROM subscriptions
        WHERE provider = ${provider.id}
          AND provider_subscription_id = ${sub.id}
        LIMIT 1;
      `);

      const shouldSync =
        !existing[0] ||
        Date.now() - new Date(existing[0].provider_event_at).getTime() > 24 * 3600 * 1000;

      if (shouldSync) {
        await syncSubscription(sub.id, provider, db);
        syncedSubscriptions++;
      }
    }
  } catch (err) {
    log.error({ err }, 'error during subscriptions reconciliation sweep');
  }

  // 4. Mark abandoned pending orders older than 48 hours as failed
  const expiredOrders = await db.execute<{ id: string }>(sql`
    UPDATE billing_orders
    SET status = 'failed', updated_at = now()
    WHERE status = 'pending'
      AND created_at < now() - interval '48 hours'
    RETURNING id;
  `);
  abandonedOrdersMarkedFailed = expiredOrders.length;

  log.info(
    { fixedPurchases, syncedSubscriptions, abandonedOrdersMarkedFailed, redrivenEvents },
    'billing reconciliation completed',
  );

  return {
    fixedPurchases,
    syncedSubscriptions,
    abandonedOrdersMarkedFailed,
    redrivenEvents,
  };
}

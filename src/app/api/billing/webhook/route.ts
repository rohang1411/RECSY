import { type NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { env } from '@/env';
import { getDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { getBillingProvider } from '@/services/billing/provider';
import {
  claimBillingEvent,
  markEventProcessed,
  markEventFailed,
  markEventIgnored,
} from '@/services/billing/inbox';
import { fulfilCheckoutSession, applyRefund, applyDispute } from '@/services/billing/fulfil';
import { syncSubscription } from '@/services/billing/subscription-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const log = logger.child({ component: 'billing-webhook' });

export async function POST(request: NextRequest): Promise<NextResponse> {
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Bad request body' }, { status: 400 });
  }

  const signature = request.headers.get('stripe-signature') ?? '';
  const provider = getBillingProvider();

  let event: ReturnType<typeof provider.verifyWebhook>;
  try {
    event = provider.verifyWebhook(rawBody, signature);
  } catch (err) {
    log.warn({ err }, 'webhook signature verification failed');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Livemode mismatch guard (Section 9.1 Principle 5)
  if (env.STRIPE_MODE && event.livemode !== (env.STRIPE_MODE === 'live')) {
    log.info(
      { eventId: event.eventId, livemode: event.livemode, stripeMode: env.STRIPE_MODE },
      'ignoring webhook event due to livemode mismatch',
    );
    return NextResponse.json({ ignored: 'mode' }, { status: 200 });
  }

  const db = getDb();
  const claim = await claimBillingEvent(event, db);

  if (claim.outcome === 'duplicate') {
    return NextResponse.json({ duplicate: true }, { status: 200 });
  }

  if (claim.outcome === 'busy') {
    return NextResponse.json({ busy: true }, { status: 409 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        if (event.refs.checkoutId) {
          await fulfilCheckoutSession(event.refs.checkoutId, provider, db);
        }
        break;
      }

      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        if (event.refs.checkoutId) {
          await db.execute(sql`
            UPDATE billing_orders
            SET status = 'failed', updated_at = now()
            WHERE provider = ${provider.id}
              AND provider_checkout_id = ${event.refs.checkoutId};
          `);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.paused':
      case 'customer.subscription.resumed': {
        if (event.refs.subscriptionId) {
          await syncSubscription(event.refs.subscriptionId, provider, db);
        }
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        if (event.refs.subscriptionId) {
          await syncSubscription(event.refs.subscriptionId, provider, db);
        }
        break;
      }

      case 'charge.refunded': {
        if (event.refs.chargeId) {
          await applyRefund(event.refs.chargeId, provider, db);
        }
        break;
      }

      case 'charge.dispute.created': {
        if (event.refs.disputeId && event.refs.chargeId) {
          await applyDispute(event.refs.disputeId, event.refs.chargeId, 'created', provider, db);
        }
        break;
      }

      case 'charge.dispute.closed': {
        if (event.refs.disputeId && event.refs.chargeId) {
          await applyDispute(event.refs.disputeId, event.refs.chargeId, 'won', provider, db);
        }
        break;
      }

      default: {
        await markEventIgnored(claim.eventRowId, db);
        return NextResponse.json({ ignored: 'type' }, { status: 200 });
      }
    }

    await markEventProcessed(claim.eventRowId, db);
    return NextResponse.json({ received: true }, { status: 200 });
  } catch (err) {
    await markEventFailed(claim.eventRowId, err, db);
    log.error(
      { err, eventId: event.eventId, eventType: event.type },
      'billing webhook processing failed',
    );
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}

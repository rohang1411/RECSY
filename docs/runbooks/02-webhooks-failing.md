# Runbook 02: Webhooks Failing

**Scope:** Stripe Webhook Processing & Credit Fulfillment
**Normative Reference:** Plan 25 Section 11.7.2, 9.8, 13.4.

---

### 1. Symptoms

- Alert `webhook_backlog` or `webhook_signature_invalid` fires.
- Users report paid orders or credit packs not showing up in their balance.
- `/internal/billing` indicates unprocessed webhook events in status `failed` or `received`.

### 2. Check

1. Inspect the webhook inbox backlog:
   ```sql
   SELECT id, type, status, attempts, error_message, created_at
   FROM billing_events
   WHERE status IN ('failed', 'received')
   ORDER BY created_at DESC LIMIT 10;
   ```
2. Verify that `STRIPE_WEBHOOK_SECRET` matches the endpoint configuration in the Stripe Dashboard.
3. Check application logs for signature verification rejections (`billing_webhook_signature_invalid`).

### 3. Action

1. If the webhook secret was mismatched or rotated, update `STRIPE_WEBHOOK_SECRET` in environment variables and trigger deployment.
2. Run manual billing reconciliation to heal unfulfilled orders:
   ```bash
   pnpm billing:reconcile
   ```
3. If an individual customer is waiting on a stuck order:
   - Go to `/internal/billing` → Customer Lookup.
   - Verify the Stripe Checkout session succeeded in the Stripe Dashboard.
   - Manually grant the purchased credit pack via **Grant Adjustment Credits**.

### 4. Verify

1. Verify `billing_events` backlog is zero:
   ```sql
   SELECT COUNT(*) FROM billing_events WHERE status IN ('failed', 'received');
   ```
2. Check that customer wallets reflect fulfilled credit balances.

### 5. Follow-up

- Inspect failed webhook payload JSON for unexpected schema additions from Stripe API version upgrades.
- Confirm Stripe Dashboard delivery retry logs report HTTP 200.

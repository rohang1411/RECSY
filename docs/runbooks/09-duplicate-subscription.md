# Runbook 09: Duplicate Subscription / Wrong Charge

**Scope:** Customer Billing Synchronization & Duplicate Resolution
**Normative Reference:** Plan 25 Section 11.7.9, 9.6, 9.8.

---

### 1. Symptoms

- Customer reports being billed twice for the same billing cycle or having two concurrent active subscriptions.
- Stripe Dashboard indicates multiple active subscriptions attached to the same customer ID.

### 2. Check

1. Search user in `/internal/billing` by customer email.
2. Inspect `subscriptions` table for multiple active rows:
   ```sql
   SELECT id, provider_sub_id, plan_code, status, current_period_end
   FROM subscriptions
   WHERE user_id = :userId;
   ```
3. Open the customer in the Stripe Dashboard to compare creation timestamps.

### 3. Action

1. **Cancel redundant subscription in Stripe:**
   - In Stripe Dashboard, cancel the duplicate subscription immediately with refund of the duplicate charge.
2. **Synchronize database state:**
   - Run billing reconciliation:
     ```bash
     pnpm billing:reconcile
     ```
   - Or wait for `customer.subscription.deleted` webhook to arrive.
3. If necessary, grant compensatory credits via `/internal/billing` → **Grant Adjustment Credits**.

### 4. Verify

1. Verify only 1 active subscription row remains for the customer:
   ```sql
   SELECT COUNT(*) FROM subscriptions WHERE user_id = :userId AND status = 'active';
   ```
2. Confirm Stripe refund appears in customer's bank statement.

### 5. Follow-up

- Inspect checkout creation race conditions to ensure concurrent checkout launches are blocked client-side.

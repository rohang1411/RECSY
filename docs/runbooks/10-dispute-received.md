# Runbook 10: Dispute Received

**Scope:** Chargebacks, Fraud Claims & Account Hold Handling
**Normative Reference:** Plan 25 Section 11.7.10, 9.7, 13.4.

---

### 1. Symptoms

- Alert `dispute_opened` fires.
- Stripe webhook `charge.dispute.created` received and logged.
- Customer order status updated to `disputed`.

### 2. Check

1. Look up the dispute in Stripe Dashboard to check reason code (`fraudulent`, `unrecognized`, `subscription_canceled`).
2. Search customer in `/internal/billing` by email:
   - Check account creation date and last seen IP.
   - Inspect query leases history to demonstrate delivered product usage.
   - Inspect delivered turns and chat answers.

### 3. Action

1. **Set Billing Hold:**
   - In `/internal/billing` → Click **Set Billing Hold** on customer profile.
   - This prevents new subscription billing and blocks deletion requests while the dispute is pending.
2. **Compile Evidence for Stripe:**
   - Account email and verified registration timestamp.
   - Log of delivered smartphone recommendations with timestamps and client IP hashes.
   - Terms of Service acceptance record (`terms_version` and `terms_accepted_at`).
   - Submit evidence package in Stripe Dashboard before the response deadline.

### 4. Verify

1. Verify `user_profiles.billing_hold` is `true`.
2. Ensure Stripe Dashboard confirms dispute evidence submitted.

### 5. Follow-up

- When dispute is resolved (won or lost via `charge.dispute.closed` webhook):
  - If won: clear billing hold in `/internal/billing`.
  - If lost: keep billing hold or suspend account if fraud confirmed.

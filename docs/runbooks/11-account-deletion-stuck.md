# Runbook 11: Account Deletion Stuck

**Scope:** GDPR / CCPA 30-Day Erasure Processing & FK Cascades
**Normative Reference:** Plan 25 Section 11.7.11, 10.5, 15.2.

---

### 1. Symptoms

- Account deletion request exceeds 30-day grace period without completing.
- Foreign key constraint error logged during `scripts/account-maintenance.ts` execution.
- Customer inquires about unresolved data erasure confirmation.

### 2. Check

1. Query pending deletion requests due for execution:
   ```sql
   SELECT id, user_id, requested_at, execute_after, status
   FROM account_requests
   WHERE kind = 'delete'
     AND status = 'pending'
     AND execute_after <= now();
   ```
2. Check if user is blocked by billing hold or open dispute:
   ```sql
   SELECT u.id, u.email, u.billing_hold, u.status
   FROM user_profiles u
   WHERE u.id = :userId;
   ```
3. Inspect Stripe customer cancellation status.

### 3. Action

1. If user has an open dispute or active chargeback, deletion MUST be held until dispute settles (statutory exception). Inform the user calmly.
2. If hold is cleared, manually execute the account maintenance sweeper:
   ```bash
   tsx --env-file=.env.local scripts/account-maintenance.ts
   ```
3. If an unexpected foreign key error occurred:
   - Identify referencing table from Postgres error log.
   - Run FK cascade cleanup in accordance with Section 10.5.
   - Delete auth user via Supabase admin API.

### 4. Verify

1. Verify `user_profiles` row is deleted.
2. Verify `account_requests.status` is marked `completed`.
3. Verify Supabase Auth user is removed.

### 5. Follow-up

- Ensure daily `account-maintenance.yml` workflow runs without failures.

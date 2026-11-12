# Runbook 12: Rollback

**Scope:** Reversible Rollout Stages & Emergency Degradation
**Normative Reference:** Plan 25 Section 11.7.12, 17.1.

---

### 1. Symptoms

- Severe production regression, persistent 500 error wave, or database deadlocks following a deployment.
- High refund ratio or metering engine failure across all routes.

### 2. Rollout Stage Matrix & Rollback Levers

| Active Stage        | Lever / Mechanism       | Instant Rollback Action                                                                               |
| ------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| **S1 Shadow**       | `QUOTA_MODE`            | Set `QUOTA_MODE=off` in Vercel environment variables → Instant.                                       |
| **S2 Accounts**     | `SIGNUPS_ENABLED`       | Set `signups_enabled = false` in `/internal/usage` flag editor.                                       |
| **S3 Enforce Free** | `QUOTA_MODE`            | Set `QUOTA_MODE=shadow` (instant fallback to non-blocking shadow logging), then `off`.                |
| **S4 Billing Test** | `BILLING_ENABLED`       | Set `BILLING_ENABLED=false` in Vercel environment variables.                                          |
| **S5 Billing Live** | `paid_checkout_enabled` | Set `paid_checkout_enabled = false` in `/internal/usage` flag editor; webhook and reconcile continue. |
| **Any Stage**       | **Kill Switch**         | Toggle **Kill Switch** to ON in `/internal/usage` (sheds all traffic with 503).                       |

### 3. Action (Step-by-Step)

1. **Step 1: Disarm via Flags (Zero Deployment Time):**
   - Access `/internal/usage` or connect via SQL.
   - Flip offending platform flag (`kill_switch`, `paid_checkout_enabled`, `signups_enabled`).
   - Flags take effect within 10 seconds across all serverless instances due to in-memory TTL.
2. **Step 2: Rollback Vercel Deployment:**
   - In Vercel Dashboard → Select previous known stable deployment → Click **Rollback**.
   - Stable build goes live within 30 seconds.
3. **Step 3: Database Migrations Rule:**
   - **NEVER roll back database migrations.**
   - All migrations (0012, 0013, 0014) are strictly additive (new tables, indexes, nullable columns, backward-compatible functions).
   - Old code continues to run safely against newer schema.

### 4. Verify

1. Verify error rates drop to baseline on `/api/health`.
2. Ensure `/recommend` serves recommendations without error.

### 5. Follow-up

- Conduct a blameless post-mortem.
- Add regression test in CI before re-attempting rollout stage advancement.

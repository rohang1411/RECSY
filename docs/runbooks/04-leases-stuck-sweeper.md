# Runbook 04: Leases Stuck / Sweeper Dead

**Scope:** Lease Expiration & Sweeper Maintenance
**Normative Reference:** Plan 25 Section 11.7.4, 7.3.2, 13.4.

---

### 1. Symptoms

- Alert `lease_leak` fires (reserved leases older than 5 minutes past expiry).
- Users report `429 TOO_MANY_INFLIGHT` errors even when they have no active tabs open.
- GitHub Actions workflow `metering-maintenance.yml` failing or disabled.

### 2. Check

1. Count stuck reserved leases:
   ```sql
   SELECT COUNT(*), MIN(expires_at)
   FROM query_leases
   WHERE status = 'reserved' AND expires_at < now();
   ```
2. Check the last run of the maintenance sweeper:
   - Check GitHub Actions tab for `metering-maintenance.yml`.
   - Inspect database audit logs for `lease_sweep` events.

### 3. Action

1. Run the maintenance sweeper manually from CLI:
   ```bash
   pnpm metering:maintain
   ```
2. If executing direct SQL recovery:
   ```sql
   SELECT recsy_sweep_expired_leases();
   ```
3. If GitHub Actions cron is paused or degraded, trigger manual `workflow_dispatch` on `metering-maintenance.yml` or enable Supabase `pg_cron` schedule.

### 4. Verify

1. Ensure stuck reserved lease count is zero:
   ```sql
   SELECT COUNT(*) FROM query_leases WHERE status = 'reserved' AND expires_at < now();
   ```
2. Verify affected users can resume sending recommendation queries.

### 5. Follow-up

- Confirm `metering-maintenance.yml` runs every 15 minutes as scheduled.

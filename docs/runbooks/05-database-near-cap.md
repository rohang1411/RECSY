# Runbook 05: Database Near Cap / Paused

**Scope:** Postgres Disk Space & Connection Limits
**Normative Reference:** Plan 25 Section 11.7.5, 6.7, 13.4.

---

### 1. Symptoms

- Alert `db_size` fires (> 70% or > 85% of plan storage ceiling).
- Database operations return `disk full` or `remaining connection slots reserved`.
- Supabase project enters read-only or maintenance mode.

### 2. Check

1. Query table sizes to identify the largest disk consumers:
   ```sql
   SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE relkind = 'r' AND n.nspname = 'public'
   ORDER BY pg_total_relation_size(c.oid) DESC
   LIMIT 10;
   ```
2. Check age distribution in `query_leases` and `usage_counters`:
   ```sql
   SELECT MIN(created_at), COUNT(*) FROM query_leases;
   ```

### 3. Action

1. Run table retention pruning:
   ```bash
   pnpm db:prune
   ```
2. Manually purge leases older than 30 days if retention policy allows:
   ```sql
   DELETE FROM query_leases WHERE created_at < (now() - interval '30 days');
   DELETE FROM usage_counters WHERE usage_date < (now() AT TIME ZONE 'UTC')::date - 14;
   ```
3. Run `VACUUM ANALYZE` on trimmed tables:
   ```sql
   VACUUM ANALYZE query_leases;
   VACUUM ANALYZE usage_counters;
   ```
4. If organic growth requires larger capacity, upgrade Supabase compute/disk tier.

### 4. Verify

1. Confirm database usage drops below 70% in Supabase dashboard.
2. Confirm health checks return `200 OK` on `/api/health`.

### 5. Follow-up

- Ensure daily prune job is active in `.github/workflows/metering-maintenance.yml`.

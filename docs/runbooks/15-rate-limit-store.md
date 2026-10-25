# Runbook 15: Rate-Limit Store Operations & Database Hygiene

> **Scope:** `RateLimitStore`, `PostgresRateLimitStore`, `rate_limits` table, Single-Statement Admission  
> **Audience:** Operators, backend engineers, database administrators  
> **Trigger:** Database pooler connection pressure, `rate_limit_store_error` logs, or pruning failures

---

## 1. Symptoms

- **Alert / Logs:** `rate_limit_store_error` events appearing in `metered_request_summary` logs.
- **Database Metrics:** Connection pooler (Supavisor port 6543) active connections exceeding 80% capacity.
- **Transaction Warnings:** Postgres `40P01` deadlock detection or statement timeout errors on `rate_limits` table.
- **Storage Warning:** `rate_limits` table growing beyond 50,000 rows due to missed pruning runs.

---

## 2. Architecture & Rules of Engagement

1. **Rule R3 (Fail-Open on Rate Limit Store Error):**
   Unlike quota reservation (which is strictly fail-closed), rate-limit store errors **fail open**. If Postgres is momentarily slow or unresponsive during rate-limit evaluation, the request is permitted through to ensure database hiccups do not turn into false 429 / 500 rejections for legitimate users.
2. **Single-Statement Batching:**
   All 3 admission limits (IP, User, Device) are upserted in a single multi-row statement (`src/services/rate-limit/store.ts`) with lexicographically sorted keys to mathematically eliminate deadlock order hazards.
3. **Gate Status (D26-2):**
   External Redis (Upstash) is **OFF** by default to maintain 100% free-tier operation. It is only considered if Postgres rate limiting exceeds 50 upserts/sec sustained over 5 minutes or rate-limit statements consume > 20% of database CPU.

---

## 3. Check

### 3.1 Check Row Count & Table Size

Run this query in Supabase SQL Editor:

```sql
SELECT
  count(*) AS total_rows,
  pg_size_pretty(pg_total_relation_size('rate_limits')) AS total_size
FROM rate_limits;
```

_(Healthy state: total_rows < 10,000; total_size < 10 MB)._

### 3.2 Check for High-Frequency Keys

Identify if an attacker or runaway scraper is flooding a single key:

```sql
SELECT key, count, window_start
FROM rate_limits
WHERE window_start >= now() - INTERVAL '5 minutes'
ORDER BY count DESC
LIMIT 10;
```

---

## 4. Action

### 4.1 Step 1: Emergency Table Pruning

If pruning fell behind and the table has accumulated millions of expired 1-minute windows:

Run the consolidated database pruning script:

```bash
pnpm tsx scripts/db-prune.ts
```

This deletes all rows older than 2 hours in small indexed batches, reclaiming disk pages without locking out active requests.

### 4.2 Step 2: Fallback to Legacy Per-Limit Statements

If the single-statement multi-row JSON upsert exhibits syntax incompatibilities with an external proxy, immediately flip `admission_single_statement` to `false` via the operator flags endpoint:

```bash
curl -X POST https://recsy.app/api/internal/flags \
  -H "Authorization: Bearer $OPERATOR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "perf_flags",
    "value": {
      "admission_single_statement": false
    }
  }'
```

This seamlessly routes admission back to individual limit queries without downtime.

### 4.3 Step 3: Mitigating an Aggressive Flooding Attack

If an IP or device is hammering the endpoint:

1. Identify the offending hashed IP or device UUID from Step 3.2.
2. Insert an immediate abuse block via the administrative action endpoint:
   ```bash
   curl -X POST https://recsy.app/api/internal/billing/action \
     -H "Authorization: Bearer $OPERATOR_SECRET" \
     -H "Content-Type: application/json" \
     -d '{
       "action": "create_abuse_block",
       "kind": "ip_key",
       "value": "<hashed_ip_key>",
       "reason": "Runaway automated flood"
     }'
   ```
   _(Abuse blocks are cached in-memory with 30s TTL and block requests before any database rate-limit statement executes)._

---

## 5. Verify

1. **Verify Database Execution Times:**
   ```sql
   SELECT query, calls, mean_exec_time
   FROM pg_stat_statements
   WHERE query LIKE '%rate_limits%'
   ORDER BY calls DESC
   LIMIT 5;
   ```
   Confirm mean execution time is < 5ms.
2. **Check Logs:**
   Verify `rate_limit_store_error` occurrences drop to zero.

---

## 6. Follow-up

1. Confirm that GitHub Actions workflow `.github/workflows/db-maintenance.yml` is running scheduled cron executions of `scripts/db-prune.ts`.
2. Do NOT switch `rate_limits` to `UNLOGGED` without written approval, as unlogged tables are excluded from Supabase WAL-based automated backups.

# Runbook 01: LLM Budget Burning Fast

**Scope:** Platform Gateway / Daily Quota Consumption
**Normative Reference:** Plan 25 Section 11.7.1, 13.4, 13.5.

---

### 1. Symptoms

- Alert `cap_80` or `cap_100` fires in `#ops-alerts`.
- `/internal/usage` telemetry displays capacity status `BUSY` or `PAUSED`.
- Unusual spike in token consumption in `/internal/pipeline` LLM telemetry.
- High velocity of queries originating from single IP prefixes or device fingerprints.

### 2. Check

1. Open `/internal/usage` to observe current query throughput and active admission rung.
2. Inspect top query volumes by device and IP prefix:
   ```sql
   SELECT device_id, COUNT(*) AS volume
   FROM query_leases
   WHERE created_at >= (now() - interval '1 hour')
   GROUP BY device_id ORDER BY volume DESC LIMIT 10;
   ```
3. Check anonymous vs authenticated traffic share:
   ```sql
   SELECT charge_source, COUNT(*) AS count
   FROM query_leases
   WHERE created_at >= (now() - interval '1 hour')
   GROUP BY charge_source;
   ```

### 3. Action

1. If spend is unsustainable, **activate emergency kill switch** in `/internal/usage` with reason:
   - Or adjust `global_daily_platform_cap` to lower threshold.
2. If traffic originates from a abusive scraper or device cluster, create an abuse block:
   - Go to `/internal/usage` → **Add Abuse Block**
   - Kind: `device` or `ip_key`
   - Set TTL to 24 or 72 hours.
3. If necessary, lower anonymous IP daily allowance via env or flag.

### 4. Verify

1. Observe that query velocity flattens on `/internal/usage`.
2. Ensure BYOK users and valid subscribers continue to have access.
3. Check that blocked attackers receive `403 ACCOUNT_RESTRICTED` or `429 RATE_LIMITED`.

### 5. Follow-up

- Review the abusive device hashes and IP prefixes for automated bot signatures.
- Adjust Cloudflare Turnstile risk thresholds if anonymous scraping bypassed challenge gates.

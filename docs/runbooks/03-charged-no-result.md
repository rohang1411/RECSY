# Runbook 03: "I Was Charged But Got Nothing"

**Scope:** Customer Support / Incomplete Turn Delivery
**Normative Reference:** Plan 25 Section 11.7.3, 11.6.1, 15.2.

---

### 1. Symptoms

- Customer submits a support inquiry stating that a query deducted a credit or free count, but the browser dropped connection before an answer was shown.
- Alert `fair_charging` or `late_commit` fires.

### 2. Check

1. Request the customer's request ID or trace ID (shown at bottom of HUD / Account Usage tab).
2. Look up the customer in `/internal/billing` by email or user UUID.
3. Inspect their recent leases to determine the exact outcome:
   ```sql
   SELECT id, status, charge_source, cost_micros, trace_id, created_at
   FROM query_leases
   WHERE user_id = :userId
   ORDER BY created_at DESC LIMIT 5;
   ```
4. Verify whether a turn or Q&A record was stored:
   ```sql
   SELECT t.id AS turn_id, c.id AS query_id
   FROM query_leases q
   LEFT JOIN recommendation_turns t ON t.lease_id = q.id
   LEFT JOIN chat_queries c ON c.lease_id = q.id
   WHERE q.id = :leaseId;
   ```

### 3. Action

1. **Case A: Lease is `committed` without delivered turn/answer:**
   - Go to `/internal/billing` → **Grant Adjustment Credits**.
   - Grant 1 credit with reason: `Customer dropped connection on lease <leaseId>`.
2. **Case B: Lease is `reserved` (stuck in flight):**
   - The reservation will automatically expire within 45 seconds and be refunded by the sweeper. Inform the user to refresh their account page in 1 minute.
3. **Case C: Request replay available (WP-18):**
   - If user retries with the same `X-Request-Id`, the stored answer will be replayed without double-charge.

### 4. Verify

1. Confirm wallet balance increased by 1 credit in `/internal/billing`.
2. Verify customer sees updated balance in the UI.

### 5. Follow-up

- Inspect network drop logs or stream error reasons around the lease timestamp.

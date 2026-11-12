# ADR 0019: Query Metering Leases and In-Database Atomic Quota

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** Engineering & Product
- **Consulted:** Plan 25 Architecture Review

---

## Context

RECSY v2 provides conversational smartphone recommendations and grounded aspect Q&A powered by large language models. Operating free-tier and metered queries at public scale requires a fair-use quota system:

1. Every user/device receives a daily allowance of free queries (default: 2 per UTC day).
2. Users can purchase credit packs or subscribe to Pro for additional capacity.
3. Concurrent requests from the same user or device must not race to bypass limits.
4. Client disconnects, clarify questions, empty catalog results, and upstream LLM errors must not penalize the user's quota.
5. High-concurrency environments (e.g. 50 parallel requests) must guarantee exact enforcement.

Prior iterations evaluated application-side "check-then-set" logic and external caching tiers (e.g. Redis). These suffered from race conditions under concurrency (e.g., admitting 29 queries against a limit of 2) or introduced operational split-brain risks with the transactional database.

---

## Decision

We implement an atomic, in-database two-phase lease metering system in PostgreSQL:

1. **Two-Phase Metering Leases (`query_leases`):**
   - **Phase 1: Reserve (`recsy_reserve_query`).** Before making an LLM inference call, the route handler calls `recsy_reserve_query`. This checks subject allowances, increments atomic daily usage counters (`usage_counters`), checks in-flight concurrency caps, and returns an active `lease_id` and `charge_source` (`free`, `credits`, `subscription`, `byok`).
   - **Phase 2: Settle (`recsy_settle_lease`).** Upon successful response delivery, the handler commits the lease (`recsy_settle_lease(..., 'committed')`).
   - **Zero-Charge / Refund:** If the query was a clarifying question, yielded empty results, aborted, or failed upstream, the route settles with `no_charge` or `refund`, which atomically restores the user's daily counter or credit balance.

2. **Atomic Concurrency Control via Transactional Locks:**
   - Counter increments and balance deductions execute within `SECURITY INVOKER` transactional functions with row-level locks (`SELECT ... FOR UPDATE` on wallets and usage counters).
   - Concurrency tests under 40-way parallel requests prove exactly 2 queries are admitted against a limit of 2.

3. **Background Sweeper (`recsy_sweep_expired_leases`):**
   - Unsettled leases (due to server crashes or dropped connections) have a time-to-live (TTL, default 75s).
   - A scheduled sweeper job expires dangling leases and automatically restores the user's counter or credit balance.

4. **Request Replay:**
   - If a client resends a request with an existing `(device, requestId)` that already committed, the server replays the stored result with zero additional charge.

---

## Consequences

### Positive

- **Guaranteed Consistency:** Zero double-spend or quota bypass under high concurrency.
- **Fail-Safe for Users:** Upstream provider failures never consume user quota or credits.
- **Zero Extra Infrastructure:** Fully hosted within PostgreSQL without needing Redis.
- **Traceability:** Every model inference call correlates with a unique `lease_id`.

### Trade-offs / Mitigations

- **Database Load:** Each metered query performs two lightweight database roundtrips (reserve and settle). Mitigated by unmetered static defaults for crawlers and connection pooling.
- **TTL Sweeping:** Orphaned leases temporarily hold a counter slot until swept by `scripts/metering-maintenance.ts` (maximum 75 seconds).

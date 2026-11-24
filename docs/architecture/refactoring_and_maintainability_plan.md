# Comprehensive Codebase Refactoring, Observability, and Maintainability Plan

> **Status:** Consensus Approved & Verified  
> **Author:** Architecture Review Board & Multi-Agent Consensus Team  
> **Target System:** RECSY v2 (Next.js 15, Drizzle ORM, PostgreSQL CTEs, Gemini Model Gateway, Metered Ingestion & Retrieval)  
> **Date:** November 2026

---

## 1. Executive Summary

This document presents the complete codebase architecture evaluation, multi-agent adversarial debate, and verified maintainability consensus plan for RECSY v2.

Every recommendation and implemented fix in this plan is strictly grounded in forensic evidence from the running codebase, regression tests, and PostgreSQL schema definitions. Rather than changing code for cosmetic reasons, this initiative focused on eliminating latent failure modes, hardening observability, harmonizing API contracts, and ensuring that errors across the entire pipeline (validation, rate-limiting, external LLM calls, DB queries) are immediately distinguishable without requiring engineers or autonomous agents to reverse-engineer stack traces.

---

## 2. Multi-Agent Adversarial Debate & Consensus Record

To ensure zero regressions, sound architecture, and avoid over-engineering, four specialized agents and one synthesis arbiter debated each proposed change across multiple rounds.

```
       ┌────────────────────────┐
       │   Agent 1: Discovery   │ (Identified latent failure modes & drift)
       └───────────┬────────────┘
                   │
       ┌───────────▼────────────┐
       │     Agent 2: Risk      │ (Evaluated blast radius & regression risk)
       └───────────┬────────────┘
                   │
       ┌───────────▼────────────┐
       │   Agent 3: Adversary   │ (Attacked proposals for over-complication)
       └───────────┬────────────┘
                   │
       ┌───────────▼────────────┐
       │   Agent 4: Verifier    │ (Verified against schema, CI, & tests)
       └───────────┬────────────┘
                   │
       ┌───────────▼────────────┐
       │    Agent 5: Arbiter    │ (Final consensus & actionable invariant sign-off)
       └────────────────────────┘
```

### Round 1: Client Error Handling & Contract Parity (`src/lib/metered-fetch.ts`)

- **Agent 1 Proposal:** Re-write the client error handler with generic polymorphism.
- **Agent 3 (Adversary):** Unnecessary abstraction. The actual issue is contract mismatch: `http-errors.ts` emits flat `{ code, message }` JSON payloads, while standard HTTP error handlers or Next.js errors emit `{ error: string }`, but `handleMeteredError` only inspected `payload.error.code`. Flat payloads silently dropped codes and fell back to generic error toasts.
- **Consensus:** Normalize error payload inputs within `handleMeteredError` cleanly to accept flat `{ code, message }`, nested `{ error: { code, message } }`, and string `{ error: string }` without changing UI contract types.

### Round 2: Recommender Async Promise Rejection Safety (`src/services/recommender/run-recommendation.ts`)

- **Agent 1 Proposal:** Wrap the entire recommender in a retry loop.
- **Agent 2 (Risk):** High latency penalty and risk of cascading rate-limit exhaustion.
- **Agent 3 (Adversary):** Pinpointed exact bug: `embedPromise.catch(() => undefined)` in `run-recommendation.ts` was not chained onto the assigned `embedPromise` reference. If `llm.embed()` rejected during high concurrency or quota exhaustion, `await embedPromise` threw an unhandled promise rejection, crashing the recommend route even though semantic query embeddings are purely optional.
- **Consensus:** Chain `.catch()` directly to `embedPromise`, log a structured warning on rejection, and return `undefined` so that catalog ranking proceeds with aspect weights smoothly.

### Round 3: Zod Validation Response Standardization (`src/services/metering/http-errors.ts`)

- **Agent 1 Proposal:** Return nested JSON schema validation trees.
- **Agent 3 (Adversary):** Breached API compatibility. In `http-errors.ts`, `POST /api/ask` returned `{ code: 'VALIDATION', message: string }`, while `POST /api/recommend` returned `{ code: 'VALIDATION', message: object }` (the output of `err.flatten()`), breaking any consumer expecting `typeof response.message === 'string'`.
- **Consensus:** Standardize `message` to always be a string (`err.issues[0]?.message ?? 'Invalid request body'`) and attach `details: err.flatten()` on all metered routes.

### Round 4: Command Center Integrity Radar Operator Safety & Enum Alignment (`src/services/internal/integrity-audit.ts`)

- **Agent 3 (Adversary):** In `runSystemIntegrityAudit()`, the SQL CTE queried `p.msrp_usd ~ '^[0\.]+$'`, but in Drizzle schema `p.msrp_usd` is `numeric(10, 2)`. In PostgreSQL, `~` is undefined for numeric columns without `::text` casting, causing query execution failure. Furthermore, the `catch` block swallowed errors and returned `status: 'pass'`, masking severe database failures.
- **Agent 4 (Verifier):** Confirmed in `schema.ts`. When DB is down or throws, reporting `'pass'` violates observability invariants.
- **Round 4B Adversarial Finding:** In `zombie_ingest_runs`, the CTE checked `WHERE r.status = 'running'`. But in PostgreSQL schema (`schema.ts:83`), `ingest_status` enum strictly defines `('started', 'success', 'failed', 'skipped')` — there is NO `'running'` status. Comparing an enum column to an unknown enum literal causes PostgreSQL to throw `ERROR: invalid input value for enum ingest_status: "running"`, failing the query on every live database run! Furthermore, `FALLBACK_INTEGRITY_REPORT` used a module-load static `checkedAt` timestamp.
- **Consensus:** Cast `p.msrp_usd::text`, query `WHERE r.status::text IN ('started', 'running') AND r.started_at < NOW() - INTERVAL '2 hours'`, refresh `checkedAt: new Date().toISOString()` and compute accurate `executionMs` on all fallback return paths, and mark fallback status as `'fail'`.

### Round 5: CI Test Discovery Coverage (`vitest.config.ts`)

- **Agent 1 Proposal:** Reorganize test directories.
- **Agent 3 (Adversary):** Directory churn introduces merge conflicts. The actual problem was `vitest.config.ts` only included `src/**/*.{test,spec}.{ts,tsx}` and `test/security/**/*.test.ts`, causing critical scripts tests (`scripts/ci-retrieval-gate.test.ts` and `scripts/seed/creator-profiles.test.ts`) to be completely ignored during CI test execution.
- **Consensus:** Add `'scripts/**/*.test.ts'` to `vitest.config.ts`'s `include` array.

### Round 6: Command Center UI Honesty & React Runtime Contract Safety

- **Agent 3 (Adversary):** `system-integrity-radar.tsx` unconditionally rendered `<CheckCircle>` in emerald green for every metric regardless of whether corrupted pricing or orphan chunks were nonzero, and ignored `codeHygieneStatus`. In addition, if `handleMeteredError` received an object `message`, React would crash with `Objects are not valid as a React child`.
- **Consensus:** Wire `SystemIntegrityRadar` to dynamically show warning/alert badges on nonzero metric counts, render AST code hygiene scan state accurately, sanitize `message` to always be a string in `handleMeteredError`, and clamp `retrySec` to a safe positive integer.

---

## 3. Forensic Codebase Architecture & Systems Review

### 3.1 Architecture Overview

RECSY v2 follows an event-resilient, pipeline-oriented architecture:

1. **Next.js 15 App Router:** Edge and Node runtimes handling requests with security headers, same-origin validation, and request-id tracing.
2. **Quota & Metering Engine (`src/services/metering`):** Two-phase query leases (`QueryLease.reserve()` and `commit()`) ensuring zero double-charging, with automatic idempotent refunds on failure.
3. **Model Gateway (`src/services/llm`):** Multi-model router with Gemini 2.5 Flash / 2.5 Pro cascading, circuit breaking, JSON repair sanitizer, and thinking budget governors.
4. **Hybrid Retrieval Engine (`src/services/retrieval`):** Dense embeddings + pgvector combined with Reciprocal Rank Fusion (RRF), Maximal Marginal Relevance (MMR) diversification, and Corrective RAG (CRAG) gating.
5. **Scorecard Engine (`src/services/scorecard`):** Multi-aspect phone scoring with time-decay recency weighting.
6. **Command Center Radar (`src/services/internal`):** Unified observability scanning catalog integrity, orphan chunks, and telemetry.

### 3.2 Error Root-Cause Taxonomy & Logging Standard

To ensure human engineers and autonomous agents can diagnose any issue without full codebase scans, errors are categorized into deterministic classes:

| Error Category       | Diagnostic Identifier      | Emitted Code            | Observability Action                                                        |
| :------------------- | :------------------------- | :---------------------- | :-------------------------------------------------------------------------- |
| **Input Validation** | Zod schema parse failure   | `VALIDATION` (400)      | String `message` + `details: err.flatten()`, `denial: 'VALIDATION'` summary |
| **Quota Exhaustion** | Leased quota exceeded      | `QUOTA_EXHAUSTED` (402) | Quota snapshot attached, UI triggers modal                                  |
| **Rate Limit**       | IP/Device sliding window   | `RATE_LIMITED` (429)    | `Retry-After` header attached, summary logs `denial: 'RATE_LIMITED'`        |
| **BYOK Failure**     | Invalid/expired user key   | `BYOK_REJECTED` (401)   | Informative settings prompt, lease refunded                                 |
| **LLM Upstream**     | Quota / network / timeout  | `LLM_GATEWAY_ERROR`     | Circuit breaker records failure, fallback model engaged                     |
| **DB / Pooler**      | Postgres statement timeout | `DB_TIMEOUT`            | Unsettled lease refunded, structured error logged                           |
| **Integrity Audit**  | Consistency check failure  | `status: 'fail'`        | Logged with stack trace, radar badge turns red                              |

---

## 4. Implemented Fixes & Technical Details

### 4.1 Client Error Normalization (`src/lib/metered-fetch.ts`)

- **Problem:** `handleMeteredError` assumed `{ error: { code, message } }`, silently ignoring flat responses `{ code, message }` emitted by `meteredErrorResponse`.
- **Solution:** Normalized error extraction:

  ```ts
  const rawError = payload?.error;
  let code = payload?.code ?? '';
  let message = payload?.message;
  let context = payload?.context;

  if (typeof rawError === 'string') {
    message = rawError;
  } else if (rawError && typeof rawError === 'object') {
    code = rawError.code ?? code;
    message = rawError.message ?? message;
    context = rawError.context ?? context;
  }
  ```

- **Tests Added:** Comprehensive unit tests in `src/lib/metered-fetch.test.ts` verifying flat payloads, string payloads, and nested payloads.

### 4.2 Recommender Unhandled Rejection Safety (`src/services/recommender/run-recommendation.ts`)

- **Problem:** Branching `.catch()` created an unassigned promise, leaving `embedPromise` liable to throw unhandled rejections if embedding timed out or failed.
- **Solution:** Direct chaining to the assigned promise:
  ```ts
  const embedPromise = (
    shouldEmbed
      ? (input.timer ? input.timer.time('embed', runEmbed) : runEmbed()).then(
          (emb) => emb.embeddings[0],
        )
      : Promise.resolve(undefined)
  ).catch((err: unknown) => {
    input.log.warn({ err }, 'recommender query embedding failed, continuing without embedding');
    return undefined;
  });
  ```
- **Tests Added:** Mocked embedding failure in `run-recommendation.test.ts` verifying graceful recovery, warning emission, and clean return of ranked picks.

### 4.3 Metered Error Response Contract Parity (`src/services/metering/http-errors.ts`)

- **Problem:** Route-dependent `message` types (`string` on `/api/ask`, `object` on `/api/recommend`).
- **Solution:** Standardized response payload:
  ```ts
  if (err instanceof ZodError) {
    const body = {
      code: 'VALIDATION',
      message: err.issues[0]?.message ?? 'Invalid request body',
      details: err.flatten(),
    };
    // ...
    return NextResponse.json(body, { status: 400, headers });
  }
  ```
- **Tests Added:** Route characterization and unit tests in `http-errors.test.ts` verifying string `message` and object `details`.

### 4.4 Automated Integrity Audit Reliability & PostgreSQL Enum Alignment (`src/services/internal/integrity-audit.ts`)

- **Problem:**
  1. Regex operator `~` on numeric column `p.msrp_usd` caused PostgreSQL syntax error without `::text` cast.
  2. CTE subquery `zombie_ingest_runs` queried `r.status = 'running'`, which throws `ERROR: invalid input value for enum ingest_status: "running"` on real PostgreSQL instances because `ingest_status` enum strictly defines `('started', 'success', 'failed', 'skipped')`.
  3. `FALLBACK_INTEGRITY_REPORT` re-used a static module-load timestamp and swallowed connection errors with `status: 'pass'`.
- **Solution:** Explicit cast `p.msrp_usd::text`, query `WHERE r.status::text IN ('started', 'running') AND r.started_at < NOW() - INTERVAL '2 hours'`, generate dynamic fresh `checkedAt: new Date().toISOString()`, compute accurate `executionMs`, and report `status: 'fail'`.
- **Tests Added:** Fallback failure test and CTE parameter parsing in `integrity-audit.test.ts`.

### 4.5 Command Center UI Honesty (`src/app/internal/command-center/_components/system-integrity-radar.tsx`)

- **Problem:** Radar UI component hardcoded emerald `<CheckCircle>` icons on every metric row even when corrupted pricing or orphan chunks were nonzero, and ignored `report.codeHygieneStatus`.
- **Solution:** Built `MetricItem` component that dynamically switches to amber `<AlertTriangle>` for warnings (missing aspect cards, empty corpuses, malformed URLs, zombie runs) and rose `<ShieldAlert>` for failures (corrupted pricing, orphan chunks, malformed channel IDs). Dynamically renders code hygiene AST status.
- **Tests Added:** Unit test suite in `system-integrity-radar.test.tsx` verifying nominal, warning, and failure badge states.

### 4.6 Client Error Normalization & Runtime Type Guarding (`src/lib/metered-fetch.ts`)

- **Problem:** `handleMeteredError` did not verify `typeof message === 'string'`. If an object was passed, React would crash with `Objects are not valid as a React child`. Additionally, unparsed or negative `retryAfterHeader` values could pass negative `retryAfterSec`.
- **Solution:** Added runtime type guards ensuring `code` and `message` are strictly strings, clamped `retrySec` to positive integers (defaulting to 10s), and safely returned fallback strings.
- **Tests Added:** Added unit tests in `metered-fetch.test.ts` for object payload normalization and negative retry-after clamping.

### 4.7 Test Discovery Expansion & 0-Warning Codebase Hygiene

- **Problem:** `scripts/**/*.test.ts` was omitted from Vitest discovery, and 8 pre-existing ESLint warnings existed in `/api/recommend`, `recommend-use-case.ts`, and test files.
- **Solution:** Included `'scripts/**/*.test.ts'` in `vitest.config.ts`, and cleaned all unused variables and inline `import()` type annotations. Result: 0 errors, 0 warnings across the entire codebase.

---

## 5. Verification Record & Regression Invariants

| Component / Test Suite                                                        | Tests Run                 | Result   | Evidence / SLA                                              |
| :---------------------------------------------------------------------------- | :------------------------ | :------- | :---------------------------------------------------------- |
| `src/lib/metered-fetch.test.ts`                                               | 19 passed                 | PASS     | Flat, nested, string, and object payloads verified          |
| `src/services/recommender/run-recommendation.test.ts`                         | 11 passed                 | PASS     | Embed rejection recovery and logging verified               |
| `src/services/metering/http-errors.test.ts`                                   | 11 passed                 | PASS     | String message + details verified across routes             |
| `src/services/internal/integrity-audit.test.ts`                               | 4 passed                  | PASS     | Fallback failure & report metrics verified                  |
| `src/app/internal/command-center/_components/system-integrity-radar.test.tsx` | 4 passed                  | PASS     | Nominal, warning, and failure rendering verified            |
| `src/app/internal/command-center/page.test.tsx`                               | 2 passed                  | PASS     | Logger integration & fallback rendering verified            |
| `src/app/api/recommend/route.test.ts`                                         | 21 passed                 | PASS     | Full pipeline lease commitment and replay verified          |
| `src/app/api/recommend/route.characterization.test.ts`                        | 6 passed                  | PASS     | Route security, rate limits, and validation verified        |
| `scripts/ci-retrieval-gate.test.ts`                                           | 1 passed                  | PASS     | 0.885 Recall@8 (>=0.88 target), 27.14ms p99 (<=50ms target) |
| `scripts/seed/creator-profiles.test.ts`                                       | 2 passed                  | PASS     | YouTube channel regex & uniqueness verified                 |
| **Full Repository Test Suite**                                                | **219 files, 1427 tests** | **PASS** | **100% clean test execution**                               |
| `pnpm typecheck`                                                              | Full project              | PASS     | **0 TypeScript errors**                                     |
| `pnpm lint`                                                                   | ESLint + consistency      | PASS     | **0 errors, 0 warnings (100% clean)**                       |

---

## 6. Long-Term Architectural Recommendations

1. **Client Schema Synchronization:** Share Zod schema inference directly between API routes and client fetch helpers via `@/services/.../types` to ensure compile-time contract enforcement.
2. **Postgres CTE Optimization:** Continue to monitor CTE execution time in `integrity-audit.ts` to ensure single-pass scans remain under 10ms as the phones table scales past 10,000 models.
3. **Observability Trace Dashboards:** Aggregate `X-Trace-Id` headers across client telemetry, Vercel edge functions, and Supabase database statements for distributed tracing.

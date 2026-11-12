# ADR-0023: API Latency, Token Streaming, and Caching Architecture (Plan 26)

> **Status:** Accepted  
> **Date:** 2026-10-24  
> **Deciders:** Antigravity Engineering & Architecture Review  
> **Consulted:** Plan 25 Authoritative Baseline, Plan 26 Implementation Plan  
> **Informed:** Core Engineering Team

---

## 1. Context and Problem Statement

RECSY v2's metered conversational and recommendation endpoints (`/api/ask` and `/api/recommend`) operate under strict fail-closed quota metering and multi-user financial guarantees established in Plan 25. However, production telemetry and baseline instrumentation (Report 03) revealed substantial latency bottlenecks and architectural friction:

1. **Fake Streaming on `/api/ask`:** The endpoint returned an `application/x-ndjson` stream, but buffered the entire LLM response, inserted `chat_queries`, committed the lease, and only then chopped the completed string into 56-character slices. The client remained blank for ~1,180ms p50.
2. **Duplicate Network Round Trips in Auth:** Signed-in users incurred two separate `supabase.auth.getUser()` network hops per request (one in `proxy.ts` and one in `resolveRequestIdentity`).
3. **Sequential Admission Overhead:** Pre-pipeline rate limiting executed 2 to 3 separate sequential SQL statements (`consumeAskRateLimit`, `consumeUserRateLimit`, `consumeDeviceRateLimit`), adding 15ms–25ms of latency.
4. **Dynamic Rendering Penalty on Public Pages:** Root layout (`AppHeader`) dynamically accessed request cookies (`cookies().get('recsy_region')`), preventing Next.js from statically rendering `/p/[slug]` and marketing pages.
5. **Monolithic Route Controllers:** `/api/ask/route.ts` (568 lines) and `/api/recommend/route.ts` (542 lines) mingled HTTP transport, admission checks, rate limiting, LLM generation, lease refunds, and persistence into single unstructured blocks.
6. **Cloud Cost Constraints:** RECSY must run 100% on free tiers (Vercel Hobby, Supabase Free, Cloudflare Turnstile) with $0.00 recurring cloud infrastructure expenditure.

---

## 2. Decision Drivers

- **Zero Cloud Cost Increase:** Preserve 100% free-tier operation. Reject paid Redis or additional hosted services unless strictly verified by a sustained bottleneck.
- **Fail-Closed Metering Integrity:** Strict preservation of the Plan 25 pipeline order (`same-origin` → body validation → identity → suspension → rate limits → CAPTCHA → platform admission → lease reservation → work → persist → settle).
- **Zero Hallucination Streaming:** The user must receive tokens in real time, but no invalid citations (`[c:uuid]`) may ever reach the DOM.
- **Maintainability & Clean Architecture:** Separate concerns cleanly (Admission, Error Mapping, Use Cases, Controllers) and maintain 100% test pass rates with zero regressions.

---

## 3. Decisions & Rationale

### D26-1: Transport: Keep REST + NDJSON, Extend Schema Additively

- **Decision:** Keep `POST /api/ask` and `POST /api/recommend` on REST + NDJSON (`application/x-ndjson`). Add two new event types (`status` and `citation`) and stream `delta` events incrementally.
- **Rejected:** SSE (EventSource does not support POST without third-party polyfills; automatic reconnects conflict with single-use lease tokens), GraphQL (over-fetching overhead, poor streaming ergonomics for LLM generation), tRPC (adds dependencies with negligible gain over Next.js Server Actions/Components).

### D26-2: Rate Limiting: Postgres First, Redis Behind Measured Gate

- **Decision:** Maintain fixed 1-minute windows in the `rate_limits` table in PostgreSQL, but consume all limits in a **single multi-row JSON upsert statement** with sorted keys. Put the store behind `RateLimitStore` interface.
- **Gate:** Upstash Redis (WP-12) is evaluated and kept OFF by default. It may only be activated if Postgres rate limiting exceeds 50 upserts/sec sustained over 5 minutes or rate-limit statements exceed 20% of total DB time. Postgres easily accommodates current traffic with zero cost.

### D26-3: Streaming: Real Token Streaming with Streaming Citation Guard

- **Decision:** Replace buffered `chatAnswer` with `runPhoneQnaStream`, passing deltas through `CitationStreamGuard`. The guard buffers citations across chunk boundaries, verifies candidate IDs against grounded retrieval chunks, and strips invalid tags before writing to the stream.
- **Settlement:** Settle the lease immediately when the stream concludes (or refund on error).

### D26-4: Public Caching: Tagged Next Data Cache & Static ISR

- **Decision:** Wrap public non-personal catalog queries in `unstable_cache` via `src/services/cache/public-data.ts` with tags (`'phones'`, `'brands'`, `'scorecards'`). Move active region selection to a client island (`RegionSelectIsland`), allowing `/p/[slug]` and marketing pages to be statically generated with ISR (`revalidate = 600`).
- **Invalidation:** Protected endpoint `POST /api/internal/revalidate` allows automated HMAC-signed purges on ingestion promotions.

### D26-5: Runtime Switches Live in `platform_flags`

- **Decision:** Store runtime performance toggles in the `platform_flags` table under the `perf_flags` JSONB key, cached for 10 seconds in memory. Operators can toggle `ask_streaming` (`'off' | 'shadow' | 'canary' | 'on'`), `admission_single_statement`, `auth_local_claims`, and `redis_rate_limit` dynamically without redeploying code.

### D26-6: Clean Architecture by Extraction, Not Rewrite

- **Decision:** Extract shared admission logic to `src/services/metering/admission.ts` (`admitMeteredRequest`), centralized error handling and lease refunds to `src/services/metering/http-errors.ts` (`meteredErrorResponse`), and orchestration to use case classes (`AskQuestionUseCase`, `RecommendTurnUseCase`).
- **Impact:** Controllers shrank to under 215 lines each with zero behavior regressions.

### D26-7: Auth Verification: Local JWT Claims When Available

- **Decision:** Use `@supabase/auth-js` `getClaims()` for local asymmetric JWT verification against cached JWKS. Skip redundant authentication in `src/proxy.ts` for metered API routes, letting `admitMeteredRequest` handle auth once.

### D26-8: LLM Layer Hygiene & Non-Blocking Telemetry

- **Decision:** Fix double LLM usage recording, decouple usage event telemetry with Next.js `after()`, enforce circuit breakers on streaming paths, and wrap catalog loaders with `withStatementTimeout` (3s) using `SET LOCAL statement_timeout` to protect connection pools.

---

## 4. Consequences

### Positive

- Client TTFVT on `/api/ask` reduced by **76.3%** (from 1,180ms to 280ms).
- `/api/recommend` p50 latency reduced by **20.6%** (from 1,410ms to 1,120ms).
- Public phone and marketing pages return in **< 5ms** from cache without hitting PostgreSQL.
- Database admission statements reduced from 3 sequential round trips to 1 single-statement batch.
- Monolithic route files decomposed into clean, SRP-compliant architectural components (< 215 lines).
- $0.00 additional hosting or cloud vendor cost.

### Negative / Operational Considerations

- Streaming answers cannot withdraw text already emitted over the wire; unverified citation tags are stripped from the stream, leaving claims visible without the bad tag.
- Operators must maintain `REVALIDATE_SECRET` for webhook-driven cache purges.

---

## 5. Compliance & Verification

- **Characterization Tests:** `ask/route.characterization.test.ts` (9 tests) and `recommend/route.characterization.test.ts` (6 tests) assert identical HTTP contracts.
- **Full Test Suite:** 193 test files passed (1,197 tests).
- **TypeScript & Linting:** 100% clean `typecheck`, `lint`, and `check:bundle`.

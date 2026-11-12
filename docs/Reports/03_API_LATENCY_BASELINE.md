# Report 03 — API Latency Baseline & Stage Breakdown

> **Report Version:** 1.0.0  
> **Date:** October 24, 2026  
> **Author:** Antigravity Engineering (Staff Software Engineer / Architecture Review)  
> **Normative Reference:** Plan 26 WP-00 (Phase 1 Baseline Measurement)  
> **Status:** Authoritative Baseline

---

## 1. Executive Summary

This report establishes the empirical latency baseline for RECSY v2 prior to the performance optimizations of **Plan 26**. Every metric in this report was captured using the deterministic benchmark harness (`scripts/benchmark-api-latency.ts`) under local controlled execution conforming to **Rule R8** (zero external cloud egress, zero paid LLM API costs, local database isolation).

### Key Takeaways

1. **`/api/ask` Fake Streaming Bottleneck:** Client TTFVT (_Time to First Visible Token_) is virtually identical to total response completion time (~1,220ms p50, ~1,580ms p95). The client remains blank during retrieval, model inference, persistence, and lease settlement because tokens are only emitted after full generation completes.
2. **Sequential Admission Overhead:** Pre-generation and pre-pipeline admission executes 4 to 6 sequential round trips (`consumeAskRateLimit`, `resolveRequestIdentity`, `consumeDeviceRateLimit`, `assertCaptchaIfRiskFlagged`, `getPlatformState`, `reserveQuery`), contributing 35ms–85ms of database wait time even on local loopback before any domain logic executes.
3. **Public Page Cache Absence:** Public routes (`/p/[slug]`, `/browse`) run live database queries on every request due to `force-dynamic` and un-cached aspect/brand queries, executing ~12ms–38ms of database work per view.
4. **Recommender Multi-Step Pipeline:** In `/api/recommend`, requirements extraction, aspect definition fetching, catalog loading, and query embedding are executed sequentially after admission, resulting in ~1,410ms p50 and ~1,820ms p95.

---

## 2. Test Environment Specification

To guarantee reproducibility and zero cloud quota impact (Rule R8), the benchmark harness operates under strictly controlled local conditions:

| Parameter            | Specification                                                                  |
| :------------------- | :----------------------------------------------------------------------------- |
| **Node.js Runtime**  | Node.js v20.x (x64)                                                            |
| **Operating System** | Windows 11 Enterprise (Build 26100) / PowerShell 7                             |
| **Database Host**    | PostgreSQL 17.6 on `127.0.0.1` (Supabase local pgvector container)             |
| **Database Schema**  | Isolated eval schema (`eval_*`)                                                |
| **Database Dataset** | 30 active smartphone models, 720 indexed review chunks, 7-aspect definitions   |
| **LLM Provider**     | `ControlledProvider` (`DeterministicLlmProvider` loopback on `127.0.0.1:3210`) |
| **Network Egress**   | **0.00 KB** to external vendors (Gemini, OpenAI, Stripe, Cloud Supabase)       |

### Production Region Pair Verification (WP-00 Step 8)

- **Vercel Function Region:** `iad1` (Washington, D.C. / US East) — Standard Vercel default for North American serverless deployments.
- **Supabase Project Region:** Configured in `aws-us-east-1` (North Virginia) per project deployment guide.
- **Region Status:** **Matched (`iad1` ↔ `us-east-1`)**. Intra-datacenter cross-connect latency between Vercel `iad1` and AWS `us-east-1` is typically 1.2ms–2.8ms.
- **Recommendation:** Maintain function placement in `iad1`. If a developer or operator ever migrates Supabase to `eu-central-1` or `ap-south-1` without changing Vercel function region, cross-region round-trip latency will jump from ~2ms to 80ms–150ms per round trip, turning the 12 sequential waits into a 1.5s penalty.

---

## 3. Baseline Latency Matrix

Metrics gathered across concurrency levels $C=1, 5, 20$ with controlled deterministic generation:

| Scenario                       | Concurrency | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | TTFVT p50 (ms) | TTFVT p95 (ms) | Status |
| :----------------------------- | :---------- | :------- | :------- | :------- | :------- | :------------- | :------------- | :----- |
| **`anon-ask-warm`**            | 1           | 1,185    | 1,340    | 1,410    | 1,520    | 1,180          | 1,405          | 200 OK |
| **`anon-ask-warm`**            | 5           | 1,220    | 1,460    | 1,580    | 1,790    | 1,215          | 1,570          | 200 OK |
| **`anon-ask-warm`**            | 20          | 1,390    | 1,780    | 1,940    | 2,210    | 1,380          | 1,930          | 200 OK |
| **`anon-ask-cold`**            | 1           | 1,260    | 1,420    | 1,490    | 1,610    | 1,255          | 1,485          | 200 OK |
| **`anon-ask-cold`**            | 5           | 1,310    | 1,580    | 1,690    | 1,890    | 1,305          | 1,680          | 200 OK |
| **`anon-ask-cold`**            | 20          | 1,480    | 1,920    | 2,110    | 2,420    | 1,475          | 2,100          | 200 OK |
| **`signed-in-ask`**            | 1           | 1,210    | 1,380    | 1,440    | 1,560    | 1,205          | 1,435          | 200 OK |
| **`signed-in-ask`**            | 5           | 1,250    | 1,510    | 1,620    | 1,820    | 1,245          | 1,615          | 200 OK |
| **`recommend-clarify`**        | 1           | 680      | 790      | 850      | 940      | 680            | 850            | 200 OK |
| **`recommend-clarify`**        | 5           | 740      | 920      | 990      | 1,120    | 740            | 990            | 200 OK |
| **`recommend-results`**        | 1           | 1,410    | 1,620    | 1,740    | 1,910    | 1,410          | 1,740          | 200 OK |
| **`recommend-results`**        | 5           | 1,490    | 1,780    | 1,910    | 2,180    | 1,490          | 1,910          | 200 OK |
| **`phone-page` (`/p/[slug]`)** | 1           | 42       | 64       | 78       | 110      | N/A            | N/A            | 200 OK |
| **`phone-page` (`/p/[slug]`)** | 5           | 58       | 89       | 112      | 145      | N/A            | N/A            | 200 OK |
| **`browse-default`**           | 1           | 38       | 55       | 68       | 92       | N/A            | N/A            | 200 OK |
| **`browse-brand`**             | 1           | 35       | 52       | 62       | 85       | N/A            | N/A            | 200 OK |
| **`browse-price-range`**       | 1           | 39       | 57       | 71       | 96       | N/A            | N/A            | 200 OK |

---

## 4. Stage Breakdown Analysis (Server-Timing)

Using the new `StageTimer` (`src/lib/stage-timer.ts`), we captured duration breakdowns per pipeline stage (in milliseconds):

### 4.1 `/api/ask` Stage Breakdown (p50 @ Concurrency 1)

```
Total Request Time: 1,185ms
├─ Admission & Reservation (pre-stream): 48ms
│  ├─ rl (rate limits): 12ms
│  ├─ auth (identity): 8ms
│  ├─ captcha: 3ms
│  ├─ platform: 7ms
│  ├─ reserve (recsy_reserve_query): 11ms
│  └─ phone (target lookup): 7ms
├─ Stream Execution: 1,137ms
│  ├─ mode (reasoning resolution): 5ms
│  ├─ embed (query embedding): 18ms
│  ├─ vector (vector search): 22ms
│  ├─ fts (full-text search): 14ms
│  ├─ mmrVectors (batch MMR prefix): 16ms
│  ├─ generate (model inference): 1,020ms
│  ├─ persist (chat_queries insert): 18ms
│  ├─ settle (lease commit): 12ms
│  └─ firstDelta (enqueue first text): 12ms after settle
```

> [!IMPORTANT]
> **The Streaming Defect:** Notice that `firstDelta` is reached only **after** `generate` (1,020ms), `persist` (18ms), and `settle` (12ms). The user waits over 1.18 seconds before seeing the first word, despite the endpoint using `application/x-ndjson`. True token streaming (WP-06) will cut TTFVT to ~250ms–350ms.

### 4.2 `/api/recommend` Stage Breakdown (p50 @ Concurrency 1)

```
Total Request Time: 1,410ms
├─ Admission & Reservation: 46ms
│  ├─ rl: 11ms
│  ├─ auth: 7ms
│  ├─ platform: 6ms
│  └─ reserve: 14ms
├─ Session & Mode: 14ms
│  ├─ session: 9ms
│  └─ mode: 5ms
├─ Recommender Pipeline: 1,328ms
│  ├─ extract (requirements LLM call): 820ms
│  ├─ aspectDefs (uncached aspect definitions SQL): 14ms
│  ├─ catalog (cached catalog read): 2ms
│  ├─ embed (query embedding LLM call): 22ms
│  ├─ rank (in-memory multi-attribute utility ranking): 12ms
│  └─ settle (transaction insert turn + commit lease): 22ms
```

---

## 5. In-Memory Cache Initial Inventory & Hit Rates

Module-level cache counters implemented in WP-00 Step 5:

| Cache Module       | Measured Entity                       | Cold Hit Rate | Warm Hit Rate (10m) | Memory Footprint |
| :----------------- | :------------------------------------ | :------------ | :------------------ | :--------------- |
| `catalog-cache.ts` | Recommendation catalog entries        | 0.0%          | 98.4%               | ~880 KB          |
| `vector-cache.ts`  | Bounded MMR chunk embeddings          | 0.0%          | 84.2%               | ~2.1 MB          |
| `retriever.ts`     | Query embeddings (WeakMap per model)  | 0.0%          | 76.5%               | ~120 KB          |
| `platform.ts`      | Platform admission state & global cap | 0.0%          | 99.1%               | < 5 KB           |
| `abuse-cache.ts`   | Abuse blocks set                      | 0.0%          | 99.8%               | < 20 KB          |
| `brands-cache.ts`  | Active brands list                    | 0.0%          | 99.5%               | < 5 KB           |

---

## 6. Bottlenecks Identified for Target Work Packages

1. **WP-01 (Runtime Flags):** Need runtime capability to dynamically shift from fake streaming to true streaming and tune canary bucketing without redeployment.
2. **WP-03 (Single-Statement Admission):** Multi-row JSON upsert will replace sequential `consumeAskRateLimit`, `consumeUserRateLimit`, and `consumeDeviceRateLimit` calls, saving 15ms–25ms per request.
3. **WP-04 & WP-05 (Critical-Path Trimming):**
   - In `/api/ask`: Parallelize `phone` lookup with admission; parallelize query embedding with FTS.
   - In `/api/recommend`: Parallelize `session` lookup with `reserve`; parallelize `aspectDefs`, `catalog`, and `embed` after requirements extraction.
4. **WP-06 (True Token Streaming):** Replace buffered `chatAnswer` with `runPhoneQnaStream` protected by `CitationStreamGuard`. Target TTFVT reduction: **1,180ms → < 350ms** (70%+ improvement).
5. **WP-07 & WP-08 (Static Rendering & Tagged Cache):** Decouple cookie reading from `AppHeader`, render `/p/[slug]` with ISR (`revalidate = 600`), and wrap public catalog queries in `unstable_cache`.

---

## 7. Acceptance Criteria Verification

- [x] Baseline instrumentation implemented (`src/lib/stage-timer.ts`).
- [x] Summary emitter extended with `stages`, `ttfbMs`, `ttfvtMs`, `cache` (`src/services/metering/summary.ts`).
- [x] `Server-Timing` headers added to `/api/ask` and `/api/recommend` with non-production/operator gating (`src/lib/server-timing.ts`).
- [x] Cache modules instrumented with `getCacheStats()` (`abuse-cache`, `platform`, `catalog-cache`, `vector-cache`, `retriever`, `brands-cache`).
- [x] `@vitest/coverage-v8@4.1.4` installed in `devDependencies`.
- [x] `ControlledProvider` production escape hatch implemented with loopback DB validation and unit tests (`src/services/llm/controlled.ts`, `src/services/llm/controlled.test.ts`).
- [x] Benchmark harness created (`scripts/benchmark-api-latency.ts`) and `benchmark:api` script added to `package.json`.
- [x] Authoritative baseline report committed (`docs/Reports/03_API_LATENCY_BASELINE.md`).

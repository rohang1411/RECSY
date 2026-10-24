# RECSY v2 — Comprehensive API Architecture, System Design & Performance Analysis

> **Document Metadata**  
> **Status:** Published; **revised v1.1 (2026-10-24)** with verified corrections. Where this report and Plan 26 v2.0.0 differ, Plan 26 and Section 10 below are authoritative  
> **Author:** Senior & Staff Software Engineering Architecture Review (FAANG / Frontier AI Perspective)  
> **Target System:** RECSY v2 (`mobile_recommender`)  
> **Stack:** Next.js 16 (App Router, Node.js Serverless) · Drizzle ORM · Supabase PostgreSQL 17.6 + pgvector · Gemini 3 Flash / 2.5 Pro · Groq · Cerebras · NVIDIA NIM · Stripe · Cloudflare Turnstile  
> **Location:** `docs/Reports/02_API_ARCHITECTURE_DESIGN_AND_PERFORMANCE_ANALYSIS.md`  
> **Date:** October 2026

> **Review note (v1.1, 2026-10-24).** This report was checked line by line against the code at `master` `9f75c08`, the Next.js 16.2.4 documentation shipped with the project, and vendor pricing pages read on 2026-10-24. Most of its structural diagnosis holds (sequential admission work, uncached public pages, Postgres-backed rate limiting, oversized route handlers). Several headline claims do not: `/api/ask` does not stream model tokens today, the proposed ISR change would be a no-op while the root layout reads cookies, the advisory lock is not a contention point, and the Upstash free-tier numbers are out of date. The original text is kept unchanged below; inline **Correction (v1.1)** notes mark the affected passages, and **Section 10** lists every verified correction with evidence. The implementation plan built from this review is Plan 26 v2.0.0 (`docs/ImplementationPlans/26. api-architecture-performance-caching-and-clean-system-design-plan.md`).

---

## Table of Contents

1. [Executive Summary & Scope of Analysis](#1-executive-summary--scope-of-analysis)
2. [Current API Inventory & Architectural Surface](#2-current-api-inventory--architectural-surface)
3. [Protocol & Paradigm Evaluation: REST vs. GraphQL vs. RPC vs. Streaming](#3-protocol--paradigm-evaluation-rest-vs-graphql-vs-rpc-vs-streaming)
4. [Case-by-Case Request & Endpoint Analysis](#4-case-by-case-request--endpoint-analysis)
5. [Bottleneck Audit: Latency, Serialization, Lock Contention & Pool Starvation](#5-bottleneck-audit-latency-serialization-lock-contention--pool-starvation)
6. [Design Patterns & SOLID Principles Audit](#6-design-patterns--solid-principles-audit)
7. [Comprehensive Caching Audit & Redis Feasibility Assessment](#7-comprehensive-caching-audit--redis-feasibility-assessment)
8. [FAANG Staff Engineer Modernization Blueprint & Architectural Roadmap](#8-faang-staff-engineer-modernization-blueprint--architectural-roadmap)
9. [Quantitative Performance Projections & ROI Summary](#9-quantitative-performance-projections--roi-summary)
10. [Verified Corrections (v1.1)](#10-verified-corrections-v11)

---

## 1. Executive Summary & Scope of Analysis

RECSY v2 is an AI-native smartphone companion combining two distinct customer experiences:

1. **A Conversational Recommender**: Multi-turn natural language intake, structured requirements extraction, aspect-weighted candidate ranking, and diversity-gated 3-card recommendation sets.
2. **A Review Consensus Engine**: Dedicated phone detail pages featuring a 7-axis aspect scorecard (camera, battery, performance, display, build, software, value) aggregated from YouTube, Reddit, and editorial reviews, coupled with a grounded Q&A chat pipeline with verifiable claim-level citations.

The platform is backed by a multi-user monetization engine (Plan 25) featuring fair-use query metering (2 free queries/day), non-expiring credit packs, RECSY Pro subscriptions via Stripe Checkout, atomic two-phase query reservation leases (`recsy_reserve_query` / `recsy_settle_lease`), zero-client-bundle Supabase Auth, and dynamic Model Gateway routing across free-tier LLM providers (Gemini, Groq, Cerebras, NVIDIA NIM).

### Scope of this Review

This architectural audit was conducted from the perspective of a **Senior/Staff Software Engineer at FAANG (Meta, Google, Netflix, Amazon)**. It evaluates:

- **API Architectural Paradigms**: Current REST/NDJSON implementations vs. GraphQL, tRPC, gRPC, and Server-Sent Events (SSE).
- **Critical Path Latency & Bottlenecks**: Multi-query database waterfalls, connection pool exhaustion (`max: 2`), serverless cold-start penalties, and serialization overhead.
- **System Design & SOLID Principles**: Clean Architecture compliance, Interface Segregation, God-handler anti-patterns, and Dependency Inversion.
- **Caching Topology & Redis Feasibility**: Ephemeral in-memory caches on serverless runtimes, Postgres write-amplification on rate limits, and the concrete ROI of introducing distributed caching (Upstash Redis / Valkey).

---

## 2. Current API Inventory & Architectural Surface

The application exposes **38 HTTP route handlers**, multiple **React Server Component (RSC) data loaders**, and **5 transactional PostgreSQL stored procedures (RPCs)**.

```mermaid
flowchart TD
  subgraph ClientTiers["Client & Web Tier"]
    Browser["Next.js React Client<br/>(Tailwind, TanStack Query, Quota HUD)"]
    Crawler["Web Crawlers / Bots<br/>(Googlebot, Bingbot)"]
  end

  subgraph NextServer["Next.js Server Runtime (Vercel Serverless Node.js)"]
    RSC["React Server Components<br/>(/browse, /p/[slug], /account)"]
    RouteHandlers["API Route Handlers<br/>(/api/ask, /api/recommend, /api/me/*)"]
    AuthHandlers["Auth Handlers<br/>(/auth/google, /auth/callback, /auth/otp/*)"]
    InternalHandlers["Internal Ops & Eval<br/>(/api/internal/*)"]
  end

  subgraph ServiceLayer["Domain & Infrastructure Services"]
    ModelGateway["Model Gateway Provider<br/>(Router, Quota Governor, Circuit Breaker)"]
    HybridRetriever["Hybrid Retriever<br/>(Vector HNSW + FTS + RRF + MMR)"]
    RecommenderEngine["Recommender Pipeline<br/>(Requirements Guard, Filter, Ranker)"]
    MeteringEngine["Metering & Lease Coordinator"]
    BillingEngine["Billing Provider (Stripe / Fake)"]
  end

  subgraph DataLayer["Persistence & External Services"]
    SupabaseDB[("Supabase PostgreSQL 17.6<br/>(pgvector, Drizzle ORM, Stored Procs)")]
    LLMPool["LLM Providers<br/>(Gemini 3 Flash/Pro, Groq, Cerebras, NVIDIA)"]
    StripeAPI["Stripe API & Webhooks"]
    Cloudflare["Cloudflare Turnstile"]
  end

  Browser -->|HTTP POST NDJSON| RouteHandlers
  Browser -->|HTTP POST JSON| AuthHandlers
  Browser -->|HTTP GET Page| RSC
  Crawler -->|HTTP GET Page| RSC
  RouteHandlers --> ServiceLayer
  RSC -->|Drizzle Direct SQL| SupabaseDB
  ServiceLayer --> SupabaseDB
  ServiceLayer --> LLMPool
  ServiceLayer --> StripeAPI
  RouteHandlers --> Cloudflare
```

### Complete API Surface Breakdown

| Category            | Route / Handler                | HTTP Method     | Data Protocol                    | Primary Responsibility                             | Data Access Mechanism                             |
| :------------------ | :----------------------------- | :-------------- | :------------------------------- | :------------------------------------------------- | :------------------------------------------------ |
| **Core Product**    | `/api/ask`                     | `POST`          | NDJSON Stream (`ReadableStream`) | Scoped grounded Q&A with claim citation validation | Drizzle ORM + Raw SQL (Vector/FTS) + Stored Procs |
| **Core Product**    | `/api/recommend`               | `POST`          | JSON                             | Multi-turn conversational phone intake & ranking   | Drizzle ORM + Stored Procs                        |
| **Core Product**    | `/api/exchange-rate`           | `GET`           | JSON                             | Regional currency conversion rates                 | Drizzle ORM                                       |
| **Core Product**    | `/api/byok/test`               | `POST`          | JSON                             | Validation of user-supplied provider API keys      | External LLM API                                  |
| **Core Product**    | `/api/set-region`              | `POST`          | JSON                             | Cookie-based country preference mutation           | HTTP Cookie serialization                         |
| **Core Product**    | `/api/health`                  | `GET`           | JSON                             | Zero-DB liveness probe                             | Pure in-memory JSON                               |
| **Core Product**    | `/api/csp-report`              | `POST`          | JSON                             | CSP violation logging                              | Pino Logger + DB Rate Limit                       |
| **Identity & Me**   | `/api/me/entitlements`         | `GET`           | JSON (ETag)                      | Viewer quota HUD snapshot, subscription status     | Drizzle ORM (Zero-DB fast path for bots)          |
| **Identity & Me**   | `/api/me/usage`                | `GET`           | JSON                             | User 30-90 day query rollup & lease audit trail    | Drizzle SQL execution                             |
| **Identity & Me**   | `/api/me/profile`              | `GET`, `PATCH`  | JSON                             | Profile metadata inspection and update             | Drizzle ORM (with Anti-CSRF check)                |
| **Identity & Me**   | `/api/me/billing`              | `GET`           | JSON                             | Wallet balance, orders, and payment methods        | Drizzle ORM                                       |
| **Account Mgmt**    | `/api/account/sessions`        | `GET`, `DELETE` | JSON                             | Cross-device recommendation session management     | Drizzle ORM                                       |
| **Account Mgmt**    | `/api/account/export`          | `POST`          | JSON                             | GDPR/CCPA data export generation                   | Drizzle ORM                                       |
| **Account Mgmt**    | `/api/account/delete`          | `POST`          | JSON                             | Soft-deletion scheduling with 7-day grace period   | Drizzle ORM + Supabase Auth Admin                 |
| **Account Mgmt**    | `/api/account/delete/cancel`   | `POST`          | JSON                             | Revocation of pending account deletion             | Drizzle ORM                                       |
| **Account Mgmt**    | `/api/account/history/delete`  | `POST`          | JSON                             | Purge of past user chat & recommendation turns     | Drizzle ORM                                       |
| **Stripe Billing**  | `/api/billing/catalog`         | `GET`           | JSON                             | Credit pack and subscription pricing catalog       | In-memory configuration                           |
| **Stripe Billing**  | `/api/billing/checkout`        | `POST`          | JSON                             | Initiation of Stripe Hosted Checkout session       | Stripe Node SDK                                   |
| **Stripe Billing**  | `/api/billing/portal`          | `POST`          | JSON                             | Stripe Customer Billing Portal session creation    | Stripe Node SDK                                   |
| **Stripe Billing**  | `/api/billing/webhook`         | `POST`          | JSON                             | Idempotent webhook receiver & fulfillment ledger   | Drizzle ORM + Stored Procs                        |
| **Authentication**  | `/auth/google`                 | `GET`           | HTTP Redirect                    | PKCE-based Google OAuth flow initiation            | Supabase SSR Client                               |
| **Authentication**  | `/auth/callback`               | `GET`           | HTTP Redirect                    | PKCE code exchange, user creation, device claim    | Supabase SSR Client + Drizzle                     |
| **Authentication**  | `/auth/confirm`                | `GET`           | HTTP Redirect                    | Email verification & magic link token confirmation | Supabase SSR Client                               |
| **Authentication**  | `/auth/otp/send`               | `POST`          | JSON                             | Passwordless 6-digit OTP delivery                  | Supabase SSR Client                               |
| **Authentication**  | `/auth/otp/verify`             | `POST`          | JSON                             | OTP verification and session cookie stamping       | Supabase SSR Client                               |
| **Authentication**  | `/auth/password/signin`        | `POST`          | JSON                             | Email + password GoTrue sign-in                    | Supabase SSR Client                               |
| **Authentication**  | `/auth/password/signup`        | `POST`          | JSON                             | Email + password registration with Turnstile       | Supabase SSR Client + Drizzle                     |
| **Authentication**  | `/auth/signout`                | `POST`          | JSON                             | Session revocation and cookie clearance            | Supabase SSR Client                               |
| **Internal / Ops**  | `/api/internal/auth`           | `POST`          | JSON                             | Operator HMAC-SHA256 session cookie login          | Cryptographic token stamping                      |
| **Internal / Ops**  | `/api/internal/flags`          | `GET`, `POST`   | JSON                             | Dynamic system feature flags management            | Drizzle ORM                                       |
| **Internal / Ops**  | `/api/internal/billing/user`   | `GET`, `POST`   | JSON                             | Admin credit adjustment & subscription view        | Drizzle ORM + Stored Procs                        |
| **Internal / Ops**  | `/api/internal/billing/action` | `POST`          | JSON                             | Administrative billing intervention actions        | Drizzle ORM + Stored Procs                        |
| **Internal / Eval** | `/api/internal/eval/*`         | `GET`, `POST`   | JSON (6 routes)                  | RAG benchmark evaluation campaigns & runs          | Drizzle ORM + Workload Guard                      |
| **Server Pages**    | `/browse`                      | RSC Render      | HTML / RSC Wire                  | Server-side phone search, faceted filter, sort     | Drizzle ORM direct query                          |
| **Server Pages**    | `/p/[slug]`                    | RSC Render      | HTML / RSC Wire                  | Phone specifications and regional pricing          | Drizzle ORM direct query                          |
| **Server Pages**    | `ScorecardSection`             | RSC Render      | HTML / RSC Wire                  | Review consensus 7-axis aspect aggregation         | Drizzle ORM direct join                           |
| **Database RPC**    | `recsy_reserve_query`          | SQL RPC         | PostgreSQL Row                   | Atomic two-phase query lease reservation           | PL/pgSQL Stored Procedure                         |
| **Database RPC**    | `recsy_settle_lease`           | SQL RPC         | PostgreSQL Row                   | Idempotent commit, refund, or no-charge settle     | PL/pgSQL Stored Procedure                         |
| **Database RPC**    | `recsy_apply_credit_delta`     | SQL RPC         | PostgreSQL Row                   | Double-entry ledger balance adjustment             | PL/pgSQL Stored Procedure                         |

---

## 3. Protocol & Paradigm Evaluation: REST vs. GraphQL vs. RPC vs. Streaming

### Current Architecture Assessment

Currently, the system uses a **tri-hybrid paradigm**:

1. **Ad-hoc REST/JSON Route Handlers**: Standard Next.js Route Handlers (`route.ts`) returning `NextResponse.json(...)`.
2. **Chunked NDJSON Streaming**: Custom `ReadableStream<Uint8Array>` serialization on `/api/ask`.
3. **Zero-HTTP Server Component Direct Invocations**: React Server Components (`page.tsx`) invoking Drizzle ORM directly without internal network hops.
4. **Relational Database RPCs**: PostgreSQL PL/pgSQL functions for transaction isolation.

### Comparative Architectural Matrix

| Dimension                   | REST (Current)                | GraphQL                                 | tRPC / Type-Safe RPC                    | Server-Sent Events (SSE)           | React Server Actions                  |
| :-------------------------- | :---------------------------- | :-------------------------------------- | :-------------------------------------- | :--------------------------------- | :------------------------------------ |
| **Client Bundle Impact**    | **0 KB** (Native `fetch`)     | **+45 to 60 KB** (Apollo/Urql client)   | **< 3 KB** (Lightweight proxy)          | **0 KB** (Native `EventSource`)    | **< 2 KB** (Next.js runtime)          |
| **Over/Under-Fetching**     | Moderate (Fixed schemas)      | **Eliminated** (Client field selection) | Moderate (Type-level binding)           | N/A (Streaming event frames)       | Controlled by action return           |
| **Streaming LLM Tokens**    | Excellent via NDJSON          | Poor (Experimental `@defer`/`@stream`)  | Complex (requires WebSockets/Sse link)  | **Native & Industry Standard**     | Clunky (experimental async iterables) |
| **HTTP Caching / CDN Edge** | **Native** (GET, ETags, SWR)  | Poor (POST requests break standard CDN) | Good for queries, poor for mutations    | No (Streaming bypasses CDN cache)  | No (POST mutations)                   |
| **Serverless Overhead**     | **Ultra-low** (< 1ms routing) | High (AST parsing, schema execution)    | **Ultra-low** (< 0.5ms routing)         | **Ultra-low** (Standard HTTP pipe) | Ultra-low (App Router native)         |
| **Type Safety Guarantees**  | Manual (Zod validation)       | Schema-driven codegen                   | **100% End-to-End TypeScript Inferred** | Manual (Typed event parsers)       | 100% Inferred TypeScript              |
| **Security / DOS Vector**   | Simple rate limiting          | Complex (Query depth/cost attacks)      | Simple procedure rate limiting          | Long-lived connection starvation   | CSRF / Action ID obfuscation          |

### The GraphQL Paradox for RECSY

Why hasn't RECSY implemented GraphQL, and should it?

- **Why GraphQL is tempting**:
  - The phone catalog entity is wide: `phones` has 30+ spec attributes, 7 aspect scores, 10+ regional price variants, and multiple media assets.
  - On `/browse`, a card needs only 5 fields. On `/compare`, two phones need 20 fields. In the conversational recommender, 3 picks need 8 fields.
  - In a traditional mobile app with limited bandwidth (e.g., RECSY v1 Flutter app on 3G/4G), GraphQL's field-level projection prevents transferring unnecessary bytes.
- **Why GraphQL is an Architectural Anti-Pattern for RECSY v2**:
  1. **React Server Components (RSC) Already Solve Over-Fetching**: In Next.js App Router, `/browse` and `/p/[slug]` execute directly inside the server process. Drizzle's `db.select({ slug: phones.slug, brand: phones.brand, ... })` performs SQL-level projection pushdown. Zero unwanted bytes ever cross the public Internet wire.
  2. **LLM Streaming Incompatibility**: The heart of RECSY is `/api/ask` and `/api/recommend`. LLM streaming requires continuous, unbuffered byte streaming. GraphQL over HTTP is designed for single-shot request/response cycles. While GraphQL subscriptions exist, they mandate persistent WebSockets, which are fundamentally incompatible with Vercel's ephemeral serverless lambdas.
  3. **Edge Caching Invalidation**: GraphQL operations are almost universally `POST` requests directed to a single `/graphql` endpoint. This invalidates standard HTTP edge caching (Cloudflare, Vercel Edge Network), preventing the use of standard `ETag`, `If-None-Match`, and `stale-while-revalidate` CDN caching.
  4. **AST Execution Overhead**: Parsing, validating against a schema, and resolving GraphQL ASTs adds 8–15ms of CPU time per request—a significant penalty in a serverless environment with strict memory/CPU allocations.

---

## 4. Case-by-Case Request & Endpoint Analysis

```mermaid
graph TD
  subgraph CaseByCase["Request Pattern Analysis & Recommended Protocol"]
    C1["1. Grounded Q&A (/api/ask)"] -->|Recommendation| P1["REST + Server-Sent Events (SSE)"]
    C2["2. Recommender (/api/recommend)"] -->|Recommendation| P2["Typed RPC / REST with Zod Contract"]
    C3["3. Browse & Filter (/browse)"] -->|Recommendation| P3["RSC + Incremental Static Regeneration (ISR)"]
    C4["4. Phone Detail (/p/[slug])"] -->|Recommendation| P4["RSC + Tagged Revalidation Cache"]
    C5["5. Quota HUD (/api/me/entitlements)"] -->|Recommendation| P5["REST GET + HTTP ETag + SWR"]
    C6["6. Account Sessions (/api/account/sessions)"] -->|Recommendation| P6["tRPC / REST Resource Pattern"]
    C7["7. Stripe Billing (/api/billing/*)"] -->|Recommendation| P7["Strict REST + Webhook Inbox"]
    C8["8. Internal Ops (/api/internal/*)"] -->|Recommendation| P8["tRPC Admin Router with Role Guard"]
  end
```

### Detailed Case Analysis

#### Case 1: Grounded Q&A Chat (`POST /api/ask`)

> **Correction (v1.1).** The route does not stream model output today. `src/services/chat/answer.ts:157` calls the non-streaming `llm.chat()`; the route waits for retrieval, the full generation (and an optional citation retry), the `chat_queries` insert and the lease settlement, and only then writes the finished text as 56-character `delta` slices (`src/app/api/ask/route.ts:336-386`). Time to first visible word therefore equals total request time. The client NDJSON reader already buffers partial lines across chunks (`src/app/p/[slug]/phone-chat.tsx:191-200`), so there is no framing problem for SSE to fix, and `EventSource` cannot send a POST body. The right fix is true token streaming over the existing NDJSON contract with a streaming citation guard (Plan 26 WP-06), not SSE. See Section 10, items 1-3.

- **Current Pattern**: REST `POST` returning an NDJSON text stream. Client manually splits chunks by newline `\n` and parses JSON objects (`type: 'delta' | 'done' | 'error'`).
- **Optimal Protocol**: **Server-Sent Events (SSE) over HTTP/2 (`text/event-stream`)**.
- **Rationale**:
  - NDJSON is prone to framing fragmentation when intermediate proxies or CDNs split TCP packets across a JSON line boundary.
  - SSE provides native framing (`event: delta\ndata: {...}\n\n`), built-in client reconnection semantics, and native browser parsing via `fetch-event-source` without manual string slicing.
- **Estimated Performance Gain**: Eliminates 15–25ms of client-side stream buffering and regex citation parsing overhead. Zero protocol-level serialization failures.

#### Case 2: Multi-Turn Recommender (`POST /api/recommend`)

- **Current Pattern**: REST `POST` taking `{ message, sessionId? }` and returning structured JSON (`kind: 'clarify' | 'results'`).
- **Optimal Protocol**: **Typed RPC (tRPC) or Strongly-Typed REST Route Handler**.
- **Rationale**:
  - The payload is strictly bounded (either 1 clarifying string or 3 phone pick objects with metadata, ~12 KB).
  - GraphQL would add schema resolution overhead without saving meaningful bandwidth.
  - The primary defect in the current implementation is the lack of streaming during Stage A (Preference Extraction). If the model decides to ask a clarifying question, the user sits through 800–1,500ms of blank waiting time before the question appears.
- **Estimated Performance Gain**: Converting Stage A to streaming text reduces Time-to-First-Token (TTFT) from 1,400ms to **220ms** (an **84% perceived latency improvement**).

#### Case 3: Public Catalog Browse & Faceted Filtering (`/browse`)

> **Correction (v1.1).** Removing `force-dynamic` alone changes nothing: the root layout renders `AppHeader`, which calls `getActiveRegion()` and therefore `cookies()` (`src/app/layout.tsx:75`, `src/components/AppHeader.tsx:15`), which makes every route dynamic; `/browse` also reads `searchParams`. `/browse` stays dynamic in Plan 26 and gains a tagged data cache for its database reads (WP-07). See Section 10, item 4.

- **Current Pattern**: React Server Component reading URL search params, executing Drizzle SQL `where` clauses, and rendering server HTML.
- **Optimal Protocol**: **React Server Component (RSC) + Incremental Static Regeneration (ISR)**.
- **Rationale**:
  - The page is currently marked `export const dynamic = 'force-dynamic'`. Every single visit—including hundreds of crawler requests—executes SQL against the Supabase database.
  - Because phone specs and prices change infrequently (daily or weekly during ingestion), computing this on every request is a severe resource drain.
- **Estimated Performance Gain**: Adding `export const revalidate = 3600` (1 hour) or tag-based revalidation drops server database queries for `/browse` by **94%**, cutting P95 page load time from 480ms to **45ms** (cached edge delivery).

#### Case 4: Phone Detail Page & Review Scorecard (`/p/[slug]`)

> **Correction (v1.1).** Static rendering of `/p/[slug]` is possible only after the root layout stops reading cookies and the page renders both regions' prices with a client-side region island (Plan 26 WP-08). In Next.js 16, `revalidateTag` requires a second argument (`revalidateTag(tag, 'max')`) and can only be called from Route Handlers and Server Functions, so pipeline scripts must call a signed revalidation endpoint instead (WP-07). The scorecard workflow runs 4 times a day, at 04:17, 10:17, 16:17 and 22:17 UTC (`.github/workflows/scorecard-auto.yml`), not only daily at 04:17. See Section 10, items 4-6.

- **Current Pattern**: Server Component fetching phone by slug, accompanied by `ScorecardSection` executing an `innerJoin` on `aspects` and `aspectDefinitions`.
- **Optimal Protocol**: **React Server Component (RSC) with On-Demand Tagged Revalidation**.
- **Rationale**:
  - Like `/browse`, this is marked `force-dynamic`.
  - Ingested review chunks and aspect scorecards only update during daily cron runs (`scorecard-auto.yml` at 04:17 UTC).
  - Serving dynamic SSR for 91 phone pages burns Supabase connection pool slots and egress quota unnecessarily.
- **Estimated Performance Gain**: Serving static HTML with `revalidateTag(`phone-${slug}`)` reduces database traffic on phone pages to zero for all regular traffic, dropping edge latency to **~35ms**.

#### Case 5: Viewer Entitlements & Quota HUD (`GET /api/me/entitlements`)

- **Current Pattern**: REST `GET` with HTTP `ETag` and conditional `304 Not Modified` return, including a zero-DB fast-path for bot user-agents and cookieless clients.
- **Optimal Protocol**: **REST GET + Client-Side Stale-While-Revalidate (SWR) Store** (Retain current approach, enhance client caching).
- **Rationale**:
  - This endpoint is already well-engineered: crawlers consume 0 DB queries, and unchanged quotas return 304 headers with 0 byte bodies.
  - GraphQL would be completely redundant here.
- **Performance State**: Optimal. Transmits only 180 bytes on 304 response.

#### Case 6: Cross-Device Sessions & History (`/api/account/sessions`, `/api/me/usage`)

- **Current Pattern**: REST `GET` with pagination (`cursor`, `limit`).
- **Optimal Protocol**: **tRPC Procedure or Standard REST**.
- **Rationale**:
  - Strictly user-authenticated, read-heavy operations.
  - REST with cursor-based pagination is clean, secure, and easily cached by client-side TanStack Query.

#### Case 7: Stripe Billing & Commerce Lifecycle (`/api/billing/*`)

- **Current Pattern**: Standard REST handlers interacting with Stripe Node SDK and webhook signature verification.
- **Optimal Protocol**: **Strict REST (Industry Standard Mandate)**.
- **Rationale**:
  - Third-party webhooks (Stripe, GitHub) mandate raw HTTP `POST` requests with cryptographic header signatures (`stripe-signature`). GraphQL or custom RPCs cannot be used for inbound webhooks.

#### Case 8: Internal Dashboard & Operational Telemetry (`/api/internal/*`)

- **Current Pattern**: Heterogeneous REST routes authenticated via custom HMAC operator cookie (`recsy_operator_session`).
- **Optimal Protocol**: **tRPC Admin Router**.
- **Rationale**:
  - The internal dashboard has 5 tabs (`/internal/command-center`, `/internal/database`, `/internal/pipelines`, `/internal/lifecycle`, `/internal/eval`) that frequently query complex, relational operational metrics.
  - Implementing an internal tRPC router gives complete type safety between frontend metric widgets and backend database queries, eliminating repetitive Zod parsing in route handlers.

---

## 5. Bottleneck Audit: Latency, Serialization, Lock Contention & Pool Starvation

A forensic review of the production codebase identified **5 critical architectural bottlenecks** that constrain throughput, elevate latency, and threaten database availability under concurrency.

```mermaid
sequenceDiagram
  autonumber
  actor User as Browser Client
  participant Edge as Next.js Serverless Route (/api/ask)
  participant DB as Supabase PostgreSQL Pooler (max: 2)
  participant LLM as Model Gateway (Groq / Gemini)

  Note over Edge,DB: Waterfall Phase 1: 5 Sequential DB Round-Trips
  User->>Edge: POST /api/ask { phoneSlug, query }
  Edge->>DB: 1. INSERT INTO rate_limits (IP Rate Limit)
  DB-->>Edge: OK (25ms)
  Edge->>DB: 2. SELECT FROM user_profiles / auth (Identity)
  DB-->>Edge: OK (20ms)
  Edge->>DB: 3. INSERT INTO rate_limits (User Limit)
  DB-->>Edge: OK (22ms)
  Edge->>DB: 4. INSERT INTO rate_limits (Device Limit)
  DB-->>Edge: OK (22ms)
  Edge->>DB: 5. SELECT FROM platform_flags
  DB-->>Edge: OK (18ms)

  Note over Edge,DB: Waterfall Phase 2: Transaction Lock & Reservation
  Edge->>DB: 6. SELECT recsy_reserve_query() [ADVISORY LOCK]
  DB-->>Edge: Lease Granted (35ms)

  Note over Edge,DB: Waterfall Phase 3: Data Retrieval
  Edge->>DB: 7. SELECT FROM phones WHERE slug = ?
  DB-->>Edge: Phone metadata (18ms)
  Edge->>DB: 8. Hybrid Retrieval (Vector + FTS + MMR)
  DB-->>Edge: Retrieved Chunks (45ms)

  Note over Edge,LLM: Waterfall Phase 4: Model Inference
  Edge->>LLM: 9. Stream Inference / Grounded Synthesis
  LLM-->>Edge: Tokens Streamed (650ms)

  Note over Edge,DB: Waterfall Phase 5: Persistence & Settle
  Edge->>DB: 10. INSERT INTO chat_queries
  DB-->>Edge: OK (20ms)
  Edge->>DB: 11. SELECT recsy_settle_lease()
  DB-->>Edge: Lease Committed (25ms)

  Edge-->>User: Complete Stream Finished (Total: ~920ms)
```

### Bottleneck 1: The Synchronous 11-Query Waterfall on Chat & Recommend

> **Correction (v1.1).** Counting from the code with cold caches, an anonymous `/api/ask` makes 12 sequential network waits before the model call and a signed-in one 15, including two Supabase Auth `getUser()` HTTP calls (one in `src/proxy.ts:54`, one in `src/services/auth/supabase-server.ts:142`) that this list omits. There is no `user_profiles` read on the identity path. Two waits are avoidable ordering: full-text search waits for the query embedding (`src/services/retrieval/retriever.ts:89-93`), and usage-event and cache writes are awaited on the critical path. See Plan 26 Section 3.2 and Section 10, items 7-8.

- **Location**: `src/app/api/ask/route.ts` (lines 136–375) and `src/app/api/recommend/route.ts` (lines 156–326).
- **The Issue**:
  To execute a single question or recommendation turn, the server executes **8 to 11 sequential database queries** across the network to Supabase:
  1. `consumeAskRateLimit(ip)` -> writes to `rate_limits` table.
  2. `resolveRequestIdentity` -> reads session cookie and user profile.
  3. `consumeUserRateLimit` -> writes to `rate_limits` table.
  4. `consumeDeviceRateLimit` -> writes to `rate_limits` table.
  5. `assertCaptchaIfRiskFlagged` -> reads `usage_counters`.
  6. `getPlatformState` -> reads `platform_flags`.
  7. `reserveQuery` -> executes `recsy_reserve_query` RPC with transaction locks.
  8. Phone lookup -> reads `phones` by slug.
  9. Hybrid retrieval -> vector search + FTS search + batch vector fetch (2–3 queries).
  10. `persistChatQuery` -> writes to `chat_queries`.
  11. `lease.commit` -> executes `recsy_settle_lease` RPC.
- **Latency Impact**:
  Even on low-latency connections (e.g. 15ms ping to Supabase pooler), 10 sequential round-trips add **150ms to 250ms of pure database network latency** _before and after_ model inference. If the pooler experiences connection queueing, this preflight phase can exceed 600ms.
- **Staff-Level Fix**:
  - **Batching & Pipelining**: Coalesce independent preflight checks (identity, platform flags, and phone existence) into a single composite CTE query or parallelize via `Promise.all`.
  - **Offload Rate Limiting**: Shift rate limiting out of PostgreSQL entirely into Redis or Edge Middleware (see [Section 7](#7-comprehensive-caching-audit--redis-feasibility-assessment)).

---

### Bottleneck 2: PostgreSQL Write Amplification via Table-Based Rate Limiting

> **Correction (v1.1).** Anonymous requests do two rate-limit upserts (IP, device); signed-in requests do three. The IP and user limits fail closed (a database error becomes a 500) while the device limit fails open (`src/services/abuse/rate-limit-device.ts:58-60`). One multi-row upsert removes one or two round trips without a new vendor (Plan 26 WP-03); Redis is justified only behind Plan 25's measured gate. See Section 10, item 9.

- **Location**: `src/services/rate-limit/consume.ts` (lines 27–134), `src/services/metering/rate-limit-user.ts`, `src/services/abuse/rate-limit-device.ts`.
- **The Issue**:
  Every incoming request to `/api/ask` or `/api/recommend` executes **three separate SQL `INSERT ... ON CONFLICT DO UPDATE` statements** into the `rate_limits` table (IP limit, User limit, and Device limit).
- **System Impact**:
  - **Write-Ahead Log (WAL) Bloat**: Every rate-limit check writes WAL records and dirties shared buffer pages in PostgreSQL.
  - **Dead Tuple Multiplication**: High-frequency updates on the same row key generate dead tuples, triggering aggressive autovacuuming and table bloat.
  - **Denial-of-Service Vulnerability**: If a malicious actor floods the API with 500 requests/sec, the database CPU spikes to 100% simply handling rate-limit row locks and upserts, knocking down legitimate user traffic.

---

### Bottleneck 3: Ephemeral In-Memory Caching on Serverless Runtimes ("The False Cache")

> **Correction (v1.1).** The "< 40% hit rate" figure is not measured; no hit/miss telemetry exists today. Plan 26 WP-00 adds counters before any cache is replaced. The query-embedding cache (`retriever.ts:297-345`, 128 entries) already exists and is missing from this inventory. See Section 10, item 10.

- **Location**:
  - `src/services/recommender/catalog-cache.ts` (`const cache = new Map<string, CacheEntry>()`)
  - `src/services/retrieval/vector-cache.ts` (`const chunkEmbeddingCache = new Map<string, CacheEntry>()`)
  - `src/app/browse/page.tsx` (`let cachedBrands = ...`)
- **The Issue**:
  In-memory `Map` objects are scoped to the Node.js process memory. In a serverless deployment environment (Vercel):
  - Every serverless function instance (lambda) boots with an **empty Map**.
  - Lambdas freeze and shut down after brief idle periods (5–15 minutes).
  - Incoming requests are distributed randomly across multiple parallel serverless instances.
- **System Impact**:
  - The measured cache hit rate on serverless is often **< 40%** under typical spiky traffic.
  - On every cache miss, the server executes heavy catalog projection queries (~0.88 MB transferred) and parses 91 complex Zod schemas and 768-dim float vectors.
  - This leads to unpredictable latency jitter: P50 latency is fast (warm lambda), but P95 and P99 spike severely whenever a request hits a cold lambda.

---

### Bottleneck 4: Row-Level Advisory Lock Contention in Query Metering

> **Correction (v1.1).** This is not a bottleneck. `pg_advisory_xact_lock` in `recsy_reserve_query` (`drizzle/migrations/0013_metering_functions.sql:103`) is a transaction-scoped lock held only for that single function call (milliseconds), keyed per subject, so it serialises only concurrent requests from the same user or device and never spans the model call. Plan 25 Section 11.4 already documents this. No change is needed. See Section 10, item 11.

- **Location**: `drizzle/migrations/0013_metering_functions.sql` (line 103).
- **Code**:
  ```sql
  PERFORM pg_advisory_xact_lock(hashtextextended('recsy:reserve:' || v_subject, 0));
  ```
- **The Issue**:
  To guarantee atomic quota enforcement (preventing a user from launching 10 concurrent requests to bypass their 2 free daily queries), `recsy_reserve_query` acquires a transaction-scoped PostgreSQL advisory lock on the user/device hash.
- **System Impact**:
  - If a user sends a rapid follow-up or double-clicks a prompt, the second request halts and blocks behind the first request.
  - If the database connection pool is constrained (`max: 2`), holding an advisory lock across multiple statements blocks pooled connections from serving other users.

---

### Bottleneck 5: Uncached SSR on Dynamic Product Pages

> **Correction (v1.1).** See the Case 3 and Case 4 corrections: the cookie-reading root layout is the real reason every page is dynamic. The connection pool (`max: 2` per instance in production, `src/services/db/client.ts`) is per instance, not global, so crawler traffic on one instance does not starve chat requests on another. See Section 10, items 4 and 12.

- **Location**: `src/app/browse/page.tsx` and `src/app/p/[slug]/page.tsx`.
- **The Issue**:
  Both pages specify `export const dynamic = 'force-dynamic'`.
  - When web search crawlers (Googlebot, Bingbot, ByteSpider) crawl the catalog of 91 phones, they fire concurrent requests across dozens of `/p/[slug]` URLs.
  - Each request hits Supabase for phone specs, regional pricing, and 7 aspect rows.
  - The production serverless pool is capped at `max: 2` connections (`src/services/db/client.ts`). Crawler spikes immediately saturate the pool, causing HTTP 500/504 errors on user chat routes.

---

## 6. Design Patterns & SOLID Principles Audit

### Current Architectural Patterns in the Codebase

```mermaid
classDiagram
  class LlmProvider {
    <<interface>>
    +chat(input)
    +chatStream(input)
    +structured(input)
    +embed(texts)
  }

  class CachedLlmProvider {
    -LlmProvider inner
    -boolean enabled
    +chat(input)
    +structured(input)
  }

  class ModelGatewayProvider {
    -ModelRouter router
    -CascadeExecutor cascade
    -MultiProviderQuotaGovernor governor
    +chat(input)
    +structured(input)
  }

  class GeminiProvider {
    +chat(input)
    +structured(input)
    +embed(texts)
  }

  class GroqProvider {
    +chat(input)
    +structured(input)
  }

  class NvidiaNimProvider {
    +chat(input)
    +structured(input)
  }

  LlmProvider <|.. CachedLlmProvider : Decorator
  LlmProvider <|.. ModelGatewayProvider : Gateway / Composite
  LlmProvider <|.. GeminiProvider : Concrete Strategy
  LlmProvider <|.. GroqProvider : Concrete Strategy
  LlmProvider <|.. NvidiaNimProvider : Concrete Strategy
  CachedLlmProvider o-- LlmProvider : Wraps
  ModelGatewayProvider o-- GeminiProvider : Dispatches
  ModelGatewayProvider o-- GroqProvider : Dispatches
  ModelGatewayProvider o-- NvidiaNimProvider : Dispatches
```

1. **Decorator Pattern**:
   - `CachedLlmProvider` (`src/services/llm/cache.ts`) wraps any underlying `LlmProvider`, intercepting `chat` and `structured` calls to check a SHA-256 prompt hash in Postgres before delegating to the concrete provider.
2. **Strategy & Adapter Pattern**:
   - Ingestion: `SourceAdapter` (`src/services/ingest/types.ts`) with concrete strategies for `YouTubeAdapter`, `RedditAdapter`, `ArticleAdapter`, and `GsmArenaAdapter`.
   - Billing: `BillingProvider` (`src/services/billing/types.ts`) with concrete strategies for `StripeBillingProvider` and `FakeBillingProvider`.
   - Models: `OpenAiCompatibleAdapter` adapting Groq, Cerebras, and NVIDIA NIM to unified inference formats.
3. **Gateway & Dynamic Semantic Router Pattern**:
   - `ModelGatewayProvider` and `ModelRouter` (`src/services/llm/gateway/`) dynamically route prompts based on token complexity and keyword conflict metrics into **Fast Tier** (Groq/Cerebras Llama 3.1 8B), **Balanced Tier** (Gemini 3 Flash), and **Reasoning Tier** (Gemini 2.5 Pro / DeepSeek-R1).
4. **Two-Phase Reservation Lease Pattern**:
   - `recsy_reserve_query` mints a temporary lease with a 75-second TTL. The route handler completes LLM inference and calls `recsy_settle_lease` to either commit (charge) or refund/no-charge. Prevents double-spending under network dropouts.
5. **Single-Flight Promise Coalescing Pattern**:
   - Implemented in `catalog-cache.ts` and `cache.ts` using an `inFlight: Map<string, Promise<T>>`. If 10 concurrent requests arrive for the same catalog or prompt simultaneously, only **one** network request is dispatched; the other 9 await the identical promise.

---

### SOLID Principles Deep Dive: Violations & Refactoring Blueprint

#### 1. Single Responsibility Principle (SRP)

- **Status**: **SEVERE VIOLATION** in Route Handlers.
- **Evidence**:
  - `src/app/api/ask/route.ts` is **651 lines of code**.
  - In a single file, it handles:
    1. HTTP header parsing & CORS/Same-Origin assertion.
    2. IP rate limiting (`consumeAskRateLimit`).
    3. JSON body parsing & Zod schema validation.
    4. Identity resolution & account suspension verification.
    5. User rate limiting & Device rate limiting.
    6. Cloudflare Turnstile CAPTCHA verification.
    7. Platform admission checks & BYOK parsing.
    8. Database quota lease reservation.
    9. Phone target validation in Postgres.
    10. Streaming response orchestration & NDJSON framing.
    11. Server reasoning mode resolution.
    12. Q&A retrieval and LLM inference.
    13. Database chat query persistence.
    14. Database lease commit / refund settlement.
    15. Structured telemetry emission (`emitMeteredRequestSummary`).
    16. Multi-branch HTTP error response formatting.
- **The Consequence**:
  - The route handler is impossible to unit-test in isolation without mocking 15 distinct external dependencies and Next.js request contexts.
  - Any change to billing rules or CAPTCHA logic risks breaking the core Q&A streaming pipeline.
- **Staff-Level Refactoring Blueprint**:
  Apply **Clean Architecture (Hexagonal Architecture)**. Decouple into 4 distinct layers:
  1. **Transport Layer (`AskController`)**: Pure Next.js route handler. Extracts HTTP headers, calls the use-case, and pipes the output stream.
  2. **Admission Middleware Pipeline (`RequestAdmissionPipeline`)**: Chains rate limits, Turnstile CAPTCHA, identity, and quota leases into a reusable middleware chain.
  3. **Application Use-Case (`AskPhoneQuestionUseCase`)**: Coordinates phone retrieval, LLM grounded answer generation, citation validation, and persistence.
  4. **Infrastructure Layer**: Concrete implementations of database persistence, LLM inference, and telemetry.

```mermaid
flowchart LR
  subgraph Transport["Transport Layer (Next.js Route)"]
    Handler["POST /api/ask Handler<br/>(50 lines)"]
  end

  subgraph Admission["Admission Pipeline"]
    Guard["AdmissionPipeline.execute()<br/>RateLimit -> Identity -> Quota"]
  end

  subgraph UseCase["Application Use-Case"]
    UC["AskQuestionUseCase.execute()<br/>Orchestrates Retrieval + LLM"]
  end

  subgraph Infrastructure["Infrastructure / Repositories"]
    Repo["PhoneRepository"]
    Retriever["HybridRetriever"]
    Gateway["ModelGateway"]
    LeaseMgr["LeaseCoordinator"]
  end

  Handler --> Guard
  Guard --> UC
  UC --> Repo
  UC --> Retriever
  UC --> Gateway
  UC --> LeaseMgr
```

---

#### 2. Open/Closed Principle (OCP)

- **Status**: **MODERATE ADHERENCE**, with key gaps.
- **Evidence**:
  - **Good**: Adding a new review source adapter (e.g. TikTok reviews) requires only implementing `SourceAdapter` and registering it in `IngestOrchestrator`. Adding a new payment provider requires only implementing `BillingProvider`.
  - **Violation**: In `src/services/llm/gateway/router.ts` and `src/services/llm/index.ts`, adding a new model provider requires modifying switch statements, enum unions, and hardcoded candidate arrays.
- **Refactoring**:
  Introduce a declarative **Provider Registry** where model providers register their capabilities (context window, cost per token, supported modalities, tier rating) via configuration rather than imperative code modifications.

---

#### 3. Liskov Substitution Principle (LSP)

- **Status**: **PARTIAL VIOLATION**.
- **Evidence**:
  `CachedLlmProvider` implements `LlmProvider`. However, its implementation of `chatStream()` is:
  ```ts
  chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    // Streaming bypasses the cache (see module docstring).
    return this.inner.chatStream(input);
  }
  ```
  A caller substituting `LlmProvider` with `CachedLlmProvider` expects caching behavior across all generation methods. However, `chatStream()` silently bypasses the cache. If a developer switches a route from `chat()` to `chatStream()`, caching guarantees silently evaporate without compile-time warnings.
- **Refactoring**:
  Either implement stream replay caching (caching chunks or full assembled response for subsequent stream replays) or segregate the interface so callers are explicitly aware when streaming is uncacheable.

---

#### 4. Interface Segregation Principle (ISP)

- **Status**: **VIOLATED**.
- **Evidence**:
  `LlmProvider` (`src/services/llm/types.ts`) forces all implementers to implement 4 methods:

  ```ts
  export interface LlmProvider {
    readonly name: string;
    chat(input: ChatInput): Promise<ChatResult>;
    chatStream(input: ChatInput): AsyncIterable<ChatDelta>;
    structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>>;
    embed(texts: readonly string[], model?: string, ...): Promise<EmbedResult>;
  }
  ```

  - Groq and Cerebras do not support vector embeddings (`embed`). In their adapters, `embed()` either throws an error or delegates back to Gemini.
  - Streaming models do not always support structured schema extraction with equivalent reliability.

- **Refactoring**:
  Segregate into focused, granular role interfaces:
  ```ts
  interface TextCompletionProvider { chat(...): Promise<ChatResult>; }
  interface StreamingCompletionProvider { chatStream(...): AsyncIterable<ChatDelta>; }
  interface StructuredOutputProvider { structured<T>(...): Promise<StructuredResult<T>>; }
  interface VectorEmbeddingProvider { embed(...): Promise<EmbedResult>; }
  ```
  The Model Gateway aggregates only the interfaces that concrete providers actually fulfill.

---

#### 5. Dependency Inversion Principle (DIP)

- **Status**: **VIOLATED** in Service Layer.
- **Evidence**:
  Throughout `src/services/`, modules directly import global singleton instances:
  ```ts
  import { getDb } from '@/services/db/client';
  import { getLlm } from '@/services/llm';
  ```
  High-level business logic modules (`runPhoneQna`, `runRecommendationPipeline`, `getUserProfile`) depend directly on low-level infrastructure singletons (`db`, `postgres`, `gemini`).
- **Refactoring**:
  Inject dependencies via parameter interfaces or a lightweight Dependency Injection container (e.g. InversifyJS or simple factory constructors). This enables instantaneous in-memory unit testing without mocking file system or database connections.

---

## 7. Comprehensive Caching Audit & Redis Feasibility Assessment

### Complete Caching Layer Inventory

| Layer / Cache Name        | Implementation Location     | Storage Medium             | Cache Key Strategy       | TTL / Invalidation                | Failure Mode                  |
| :------------------------ | :-------------------------- | :------------------------- | :----------------------- | :-------------------------------- | :---------------------------- |
| **Catalog Spec Cache**    | `catalog-cache.ts`          | In-memory `Map`            | `schema:region:emb`      | 10 minutes (Explicit invalidate)  | Degrades to full SQL query    |
| **Vector Prefix Cache**   | `vector-cache.ts`           | In-memory `Map`            | Chunk UUID               | 15 minutes (LRU cap 1,000)        | Degrades to SQL `WHERE id IN` |
| **Brand List Cache**      | `browse/page.tsx`           | In-memory `cachedBrands`   | Global static            | 1 hour                            | Degrades to SQL `GROUP BY`    |
| **Active Slugs Cache**    | `sitemap.ts`                | In-memory `slugs`          | Global static            | 1 hour                            | Degrades to SQL `SELECT slug` |
| **Dashboard Metrics**     | `database-dashboard.ts`     | In-memory `Map`            | View parameter           | 10 minutes (SWR fallback)         | Serves stale memory cache     |
| **Pipeline Run Monitor**  | `pipeline-run-monitor.ts`   | In-memory `Map`            | ETag header              | 5 minutes + GitHub ETag           | Degrades to GitHub API        |
| **Benchmark Repos**       | `benchmark-repository.ts`   | In-memory `Map`            | Run UUID                 | 5 minutes                         | Degrades to SQL               |
| **LLM Output Cache**      | `src/services/llm/cache.ts` | Postgres `llm_cache` table | SHA-256 canonical hash   | 30 days (Pruned via cron)         | Degrades to live LLM call     |
| **Entitlements ETag**     | `/api/me/entitlements`      | HTTP Client Cache          | SHA-256 snapshot hash    | Dynamic ETag (`304 Not Modified`) | Executes full DB snapshot     |
| **Client Query Cache**    | TanStack React Query        | Browser Memory             | Query key tuple          | 5 minutes default                 | Re-fetches from Next.js API   |
| **Ingestion Dedupe**      | `sources.content_hash`      | Postgres Column            | SHA-256 normalized HTML  | Permanent                         | Re-embeds source              |
| **Scorecard Fingerprint** | `scorecard_runs`            | Postgres Column            | MD5 chunk ID aggregation | Rescheduled +3d / +7d             | Re-runs 7-axis LLM agent      |

---

### Caching Gaps & High-Impact Opportunities

```mermaid
flowchart TD
  subgraph CurrentState["Current Architecture (Postgres Overloaded)"]
    Req1["Incoming Request"] --> RL1["Rate Limit Check<br/>(3x SQL Upserts in rate_limits)"]
    RL1 --> PF1["Platform Flags<br/>(SQL Query in platform_flags)"]
    PF1 --> Cat1["Catalog Fetch<br/>(Cold Lambda: 0.88 MB SQL Query)"]
    Cat1 --> Emb1["Embed Query<br/>(Always calls Gemini API)"]
  end

  subgraph OptimizedState["Target Architecture with Upstash Redis"]
    Req2["Incoming Request"] --> RL2["Redis Sliding Window<br/>(1x Redis Pipeline: 2ms)"]
    RL2 --> PF2["Redis Platform Flags<br/>(Cached in Memory/Redis: 0.5ms)"]
    PF2 --> Cat2["Redis Distributed Catalog<br/>(Shared Across Lambdas: 5ms)"]
    Cat2 --> Emb2["Redis Semantic Query Cache<br/>(Cached Embeddings: 2ms)"]
  end
```

#### Gap 1: Rate Limiting in PostgreSQL

- **The Reality**: The app executes 3 database writes per request to check rate limits.
- **The Fix**: Move rate limits to Redis. A single Redis Lua script executing a sliding-window counter (`ZADD` + `ZREMRANGEBYSCORE` + `ZCARD`) runs in **1.5ms**, completely eliminating table writes in PostgreSQL.

#### Gap 2: In-Memory Serverless Cache Invalidation

- **The Reality**: Ephemeral serverless lambdas constantly miss in-memory caches.
- **The Fix**: Store the serialized recommendation catalog (`PhoneCatalogEntry[]`) in Redis with a 30-minute TTL. Every lambda shares the identical cache. Cold starts experience **0ms database query overhead**.

#### Gap 3: Repeated User Chat Query Embeddings

- **The Reality**: Every question asked on `/p/[slug]` executes a Gemini embedding API call (`gemini-embedding-001`) to generate a 768-dim vector. Popular queries ("how long does the battery last?", "is the camera good in low light?") are embedded repeatedly.
- **The Fix**: Cache query embeddings in Redis keyed by `sha256(phoneId + query_normalized)` with a 30-day TTL. Saves 120–250ms of external network latency for recurring queries.

#### Gap 4: Platform Flags & Quota Fast-Paths

- **The Reality**: Every request reads `platform_flags` from Postgres to check if platform admission is enabled.
- **The Fix**: Cache platform flags in Redis or Edge Config (Vercel Edge Config) with sub-millisecond reads.

---

### Can We and Should We Use Redis? Technical & Economic Justification

> **Correction (v1.1).** Upstash's free tier is now 500,000 commands per month, 250 MB of data and 10 GB of bandwidth (vendor pricing page, read 2026-10-24), not 10,000 commands per day and 256 MB. A design with two or three limiters per request uses several commands per request, so the free tier covers only a few thousand metered requests per day. A cache of chunk vectors in Redis would move tens of kilobytes per request over HTTP, which is slower than the current in-process cache. Plan 26 keeps Postgres rate limiting and ships Redis only as an optional, gated adapter (WP-12). See Section 10, items 13-14.

#### 1. Is Redis Logical for RECSY?

**Yes, absolutely.** However, the deployment topology matters significantly:

- **Traditional Redis (TCP Pool)**: Connecting to a self-hosted Redis or AWS ElastiCache via TCP from Vercel Serverless causes connection pool exhaustion, exactly like PostgreSQL.
- **Serverless Redis (Upstash Redis)**: Upstash exposes a **stateless HTTP REST API** (`@upstash/redis`). It requires zero connection management, automatically pools requests over HTTP/2, and has native edge runtime support.

#### 2. Cost Analysis (Zero-Budget / Low-Budget Feasibility)

- **Upstash Free Tier**:
  - **10,000 commands per day for free** (forever).
  - Maximum 256 MB storage (RECSY's rate limits and catalog require < 15 MB).
  - Monthly cost: **$0.00**.
- **Paid Tier (when scaling past 10k commands/day)**:
  - Pay-as-you-go: **$0.20 per 100,000 commands**.
  - At 50,000 daily queries (1.5M commands/month), the monthly Redis bill is **$3.00**.
- **ROI**:
  - Saves over 60% of Supabase database compute hours.
  - Prevents upgrading Supabase from Free ($0) to Pro ($25/month) by keeping database egress < 1.0 GB and connection counts < 5.

#### 3. Concrete Performance Gains from Introducing Redis

| Operational Metric                 | Without Redis (Current)            | With Upstash Redis                  | Net Improvement                |
| :--------------------------------- | :--------------------------------- | :---------------------------------- | :----------------------------- |
| **Rate Limit Check Latency**       | 35–70ms (3 Postgres SQL queries)   | **2–4ms** (1 pipelined HTTP call)   | **10x – 17x faster**           |
| **Cold Lambda Catalog Load**       | 350–600ms (0.88 MB DB query + Zod) | **18–25ms** (Pre-parsed JSON fetch) | **15x – 24x faster**           |
| **Repeated Chat Embedding**        | 180–300ms (Gemini API call)        | **3–5ms** (Redis vector hit)        | **50x faster**                 |
| **PostgreSQL Write Transactions**  | 3 to 5 writes per chat turn        | **1 write** (final chat query log)  | **75% reduction in DB writes** |
| **P50 Chat TTFT (First Byte)**     | ~850ms                             | **~480ms**                          | **~43% latency reduction**     |
| **P95 Chat TTFT (First Byte)**     | ~2,200ms                           | **~1,100ms**                        | **~50% latency reduction**     |
| **Postgres Connection Starvation** | High risk during traffic spikes    | **Near zero**                       | Eliminates connection queueing |

---

## 8. FAANG Staff Engineer Modernization Blueprint & Architectural Roadmap

To transform RECSY v2 into an enterprise-grade, highly scalable platform capable of supporting **100,000+ Daily Active Users (DAU)**, the following phased architectural roadmap is recommended:

```mermaid
gantt
  title Architectural Modernization Roadmap
  dateFormat  YYYY-MM-DD
  section Phase 1: Tactical Hardening
  Migrate Rate Limiting to Redis           :active, p1, 2026-11-01, 7d
  Implement ISR & Tagged Revalidation     :p2, after p1, 5d
  Parallelize DB Preflight Checks         :p3, after p1, 4d
  section Phase 2: Structural Refactoring
  Clean Architecture Use-Case Decoupling  :p4, 2026-11-15, 12d
  Migrate NDJSON to Server-Sent Events    :p5, after p4, 6d
  Segregate LlmProvider Interfaces        :p6, after p5, 5d
  section Phase 3: Scale & Edge Optimization
  Multi-Tier L1/L2 Caching Pipeline       :p7, 2026-12-05, 10d
  PostgreSQL Read-Replica Splitting       :p8, after p7, 8d
  Internal Dashboard tRPC Migration       :p9, after p8, 7d
```

### Phase 1: Tactical Hardening (Zero Regressions, High ROI)

1. **Upstash Redis Rate Limiting**:
   - Create `src/services/rate-limit/redis.ts` using `@upstash/redis` and `@upstash/ratelimit`.
   - Replace table-based rate limiting on `/api/ask` and `/api/recommend`.
   - Preserve Postgres `rate_limits` table only as a fallback if Redis is unreachable (`fail-open`).
2. **Enable ISR & Tagged Revalidation on Static Catalog Pages**:
   - On `/browse`: Change `dynamic = 'force-dynamic'` to `revalidate = 3600`.
   - On `/p/[slug]`: Add `revalidateTag(`phone-${slug}`)` and invalidate via webhook whenever `ingest-auto` or `scorecard-auto` updates chunks.
3. **Pipelined Preflight Execution**:
   - In `/api/ask` and `/api/recommend`, group `resolveRequestIdentity`, `getPlatformState`, and phone target queries into `Promise.all([ ... ])` to execute in parallel, cutting preflight database latency in half.

### Phase 2: Structural Refactoring & Protocol Modernization

1. **Clean Architecture Controller/Use-Case Decoupling**:
   - Refactor `src/app/api/ask/route.ts` from 651 lines down to a lean ~60-line transport adapter.
   - Extract `AskQuestionUseCase` and `AdmissionPipeline`.
2. **Server-Sent Events (SSE) Migration**:
   - Standardize `/api/ask` on `text/event-stream`.
   - Update `phone-chat.tsx` to consume events using `@microsoft/fetch-event-source`.
3. **Interface Segregation for LLM Infrastructure**:
   - Split `LlmProvider` into `TextGenerationProvider`, `StreamingProvider`, `StructuredGenerationProvider`, and `EmbeddingProvider`.
   - Allow Groq and Cerebras to participate strictly in text/structured tiers without stubbing embedding methods.

### Phase 3: Scale & Edge Optimization

1. **Multi-Tier L1/L2 Caching Pipeline**:
   - L1: Process memory (LRU cap 500 items, 1-minute TTL for hot micro-caching).
   - L2: Upstash Redis (15–30 minute TTL for cross-instance synchronization).
   - L3: Supabase PostgreSQL (Persistent system of record).
2. **Read/Write Connection Splitting**:
   - Direct all read-heavy operations (catalog loading, hybrid vector retrieval, scorecard views) to Supabase Read Replicas or connection poolers configured with `statement_timeout: 5000`.
   - Reserve the primary write connection exclusively for `recsy_reserve_query`, `recsy_settle_lease`, and Stripe webhooks.

---

## 9. Quantitative Performance Projections & ROI Summary

### Latency Budget Comparison (Grounded Q&A `/api/ask`)

> **Correction (v1.1).** The figures in this table are estimates, not measurements, and the "LLM TTFT 520 ms" row describes streaming that does not exist yet. Plan 26 WP-00 builds a local benchmark harness that produces the real baseline; every target in Plan 26 is stated relative to that baseline. See Section 10, item 15.

```
CURRENT ARCHITECTURE (P50: ~880ms | P95: ~2,400ms)
[================================================================================]
| Preflight SQL (180ms) | Advisory Lock (35ms) | Retrieval (85ms) | LLM TTFT (520ms) | Settle (60ms) |

TARGET ARCHITECTURE WITH REDIS & SSE (P50: ~490ms | P95: ~1,250ms)
[============================================]
| Redis Preflight (15ms)| Parallel DB (40ms)   | Retrieval (65ms) | LLM TTFT (350ms) | Async Settle (20ms) |
```

### Resource Utilization & Cost Projections

> **Correction (v1.1).** Vercel Hobby is limited to non-commercial personal use and includes 4 Active-CPU hours, 1,000,000 function invocations and 10 GB fast origin transfer per month (vendor page, read 2026-10-24), not unlimited serverless usage. Supabase egress already exceeded the 5 GB Free allowance once (6.268 GB, Plan 22), which contradicts "~1.4 GB per month, plenty of headroom". Plan 26 adds no paid service; taking payments requires leaving Hobby under Plan 25 decision D2 regardless. See Section 10, item 16 and Plan 26 Section 11.

| Architecture Profile                   | Monthly DB Egress | DB Connections Peak | Avg API Latency (Chat) | Monthly Infrastructure Cost   |
| :------------------------------------- | :---------------- | :------------------ | :--------------------- | :---------------------------- |
| **Current Baseline**                   | ~1.4 GB / month   | 4 – 8 (Saturated)   | 920 ms                 | **$0.00** (Free tiers)        |
| **With Tactical Redis (Phase 1)**      | ~0.7 GB / month   | 1 – 2 (Comfortable) | 520 ms                 | **$0.00** (Upstash Free Tier) |
| **Full Target Architecture (Phase 3)** | ~0.4 GB / month   | 1 – 2 (Dedicated)   | 410 ms                 | **$0.00 – $5.00 / month**     |

### Final Engineering Verdict

RECSY v2 features sophisticated algorithmic engineering: dynamic model cascading (< 0.03ms overhead), two-phase atomic transactional metering, hybrid vector-trigram retrieval with reciprocal rank fusion, and rigorous indirect prompt injection defenses.

However, its API transport and state tiers exhibit classic **early-stage monolithic bottlenecks**: synchronous multi-query waterfalls, Postgres-backed rate limiting, and ephemeral in-memory caching across serverless lambdas.

By executing the modernization roadmap outlined in this report—specifically **adopting Server-Sent Events, decoupling route handlers into clean Use-Cases, offloading rate limiting to Upstash Redis, and enabling ISR on product pages**—the platform will achieve **sub-500ms P50 latency**, reduce database egress by **> 50%**, eliminate connection pool starvation, and scale gracefully to hundreds of thousands of users within free and low-cost infrastructure boundaries.

---

## 10. Verified Corrections (v1.1)

Checked on 2026-10-24 against `master` at `9f75c08`, the Next.js 16.2.4 docs in `node_modules/next/dist/docs`, and vendor pricing pages. File references are to that commit. The full list with design consequences is in Plan 26 Section 2.

| #   | Original claim                                                          | Verified finding                                                                                                                                                | Evidence                                                                                                         |
| :-- | :---------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| 1   | `/api/ask` streams LLM tokens; "LLM TTFT 520 ms"                        | It does not. The full answer is generated, persisted and settled before the first `delta` line is written                                                       | `src/services/chat/answer.ts:157`; `src/app/api/ask/route.ts:336-386`                                            |
| 2   | NDJSON suffers framing fragmentation; SSE fixes it                      | The client reader already buffers partial lines across chunks                                                                                                   | `src/app/p/[slug]/phone-chat.tsx:191-200`                                                                        |
| 3   | SSE gives useful built-in reconnection                                  | `EventSource` only supports GET without a body; automatic reconnection would re-send a metered request. Plan 25 froze the NDJSON events (additive changes only) | Plan 25 Section 8                                                                                                |
| 4   | Removing `force-dynamic` makes `/browse` and `/p/[slug]` ISR            | The root layout reads cookies, so every route is dynamic; `/browse` also reads `searchParams`                                                                   | `src/app/layout.tsx:75`; `src/components/AppHeader.tsx:15`; `src/lib/get-active-region.ts:10`                    |
| 5   | `revalidateTag('phone-<slug>')` from ingestion scripts                  | Next 16 requires a second argument (`'max'` or `{ expire: 0 }`), and `revalidateTag` only works in Route Handlers and Server Functions, not in scripts          | Next 16.2.4 docs, `revalidateTag`                                                                                |
| 6   | Scorecards refresh daily at 04:17 UTC                                   | The workflow runs 4 times a day (04:17, 10:17, 16:17, 22:17 UTC)                                                                                                | `.github/workflows/scorecard-auto.yml` (`17 4,10,16,22 * * *`)                                                   |
| 7   | 11-query waterfall including `user_profiles`                            | 12 sequential network waits (anonymous) or 15 (signed-in), cold caches; no `user_profiles` read; two Supabase Auth calls for signed-in users                    | Plan 26 Section 3.2                                                                                              |
| 8   | (not mentioned)                                                         | Usage events are awaited on the critical path, Gemini-served gateway calls are recorded twice, and the `llm_cache` write is awaited                             | `src/services/llm/gateway/index.ts:58,113`; `src/services/llm/gemini.ts:264`; `src/services/llm/cache.ts:83,130` |
| 9   | Three rate-limit upserts per request                                    | Two for anonymous, three for signed-in; failure policy is inconsistent (IP and user fail closed, device fails open)                                             | `src/services/rate-limit/consume.ts:27-47`; `src/services/abuse/rate-limit-device.ts:58-60`                      |
| 10  | In-memory caches hit "< 40%"                                            | Not measured; no telemetry exists. A query-embedding cache exists and was omitted                                                                               | `src/services/retrieval/retriever.ts:297-345`                                                                    |
| 11  | Advisory lock contention starves the pool                               | Transaction-scoped lock per subject, held for one function call                                                                                                 | `drizzle/migrations/0013_metering_functions.sql:103`                                                             |
| 12  | Pool `max: 2` is a global cap that crawlers saturate                    | `max: 2` is per serverless instance                                                                                                                             | `src/services/db/client.ts:27-38`                                                                                |
| 13  | Upstash free tier: 10,000 commands/day, 256 MB                          | 500,000 commands/month, 250 MB, 10 GB bandwidth; pay-as-you-go $0.20 per 100K commands                                                                          | Upstash pricing page, read 2026-10-24                                                                            |
| 14  | Redis caches for catalog and chunk vectors give 18-25 ms loads          | Unsupported; moving tens of KB per request over HTTP is slower than the in-process cache. Plan 22 Phase B reduces the payload at its source                     | Plan 22                                                                                                          |
| 15  | Latency projections in Section 9                                        | Estimates without a baseline; Plan 26 WP-00 measures the baseline first                                                                                         | Plan 26 WP-00                                                                                                    |
| 16  | Vercel Hobby "unlimited"; Supabase egress "~1.4 GB, plenty of headroom" | Hobby is non-commercial with fixed allowances; Supabase egress reached 6.268 GB against 5 GB                                                                    | Vercel pricing page, read 2026-10-24; Plan 22                                                                    |
| 17  | Stage A of the recommender can stream and cut TTFT by 84%               | Stage A extracts structured requirements needed before ranking; nothing useful can be shown early                                                               | `src/services/recommender/run-recommendation.ts:151-285`                                                         |
| 18  | (not mentioned)                                                         | Query embedding cache key: the embedding depends only on the query text, so keying it by phone id would lower the hit rate                                      | `src/services/retrieval/retriever.ts`                                                                            |
| 19  | (not mentioned)                                                         | Security: `identity.ts` honours the fake-auth cookie when `AUTH_DRIVER=fake` without the production guard that `drivers/fake.ts` applies                        | `src/services/auth/identity.ts:53-58`; `src/services/auth/drivers/fake.ts:21-24`                                 |

What stays valid from this report: the protocol choice (REST plus streaming, no GraphQL), the diagnosis that the two metered route handlers carry too many responsibilities, the need for tagged invalidation of public data, and the recommendation to avoid new paid infrastructure.

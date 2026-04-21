# ADR 0005 — Browser E2E and evaluation tiers

Date: 2026-04-21  
Status: Accepted  
Supersedes: none. Extends §10 and Phase 3+ notes in `RECSY_V2_PROJECT_CONTEXT.md`.

## Context

Phase 3 shipped phone Q&A (`/p/[slug]`, `/api/ask`). We still need:

1. **Regression safety** for the phone UI without paying for a Gemini call on
   every CI run.
2. **Retrieval quality** checks that go beyond pure maths (RRF/MMR unit tests)
   but stay cheaper and more stable than full generative eval.
3. **Operational clarity** on which commands require which infrastructure
   (Postgres only vs Postgres + embeddings vs full LLM).

## Decision

### 1. Playwright E2E (two tests)

- **SSR smoke** — Load `/p/<seed-slug>` and assert the hero heading + ask
  section render. Requires **seeded phones** in Postgres (same as local dev).
- **Mocked ask** — Intercept `POST /api/ask` with a fixed NDJSON stream and
  assert the client parses deltas and renders a citation link. **No Gemini**
  and no reliance on ingested chunks for the answer path.

CI runs these against **vanilla Postgres** (`pgvector/pgvector`) after
`pnpm exec tsx scripts/db-setup.ts`, not against Supabase. To make
`CREATE EXTENSION ... WITH SCHEMA extensions` portable, `drizzle/extensions.sql`
prepends `CREATE SCHEMA IF NOT EXISTS extensions`, and `db-setup` sets
`search_path` to `public, extensions` for the setup session so Drizzle
migrations resolve the `vector` type.

### 2. Evaluation tiers (documented in `docs/eval/README.md`)

| Tier | Command / artefact        | Needs            | Purpose                                    |
| ---- | ------------------------- | ---------------- | ------------------------------------------ |
| 0    | `pnpm test`               | Nothing external | Pure retrieval maths + citation parsing    |
| 1    | `pnpm retrieval:smoke`    | DB + embeddings  | One hybrid search sanity check             |
| 2    | `pnpm eval:retrieval`     | DB + embeddings  | Fixture JSON; min chunk count + substrings |
| 3    | Manual / scheduled script | DB + chat LLM    | Citation fidelity on real answers (TBD)    |

**Tier 2 is not in default CI** — every fixture costs at least one embedding
call. Tier 3 is intentionally out of CI until a budget and pass threshold exist.

### 3. Optional LLM rerank flag

Structured-output rerank after MMR is **off by default**. Enabling it adds one
Flash call per retrieval and is controlled only by the server env knob
`RETRIEVAL_LLM_RERANK=true` (see `src/env.ts`). On schema / model failure the
hybrid retriever **falls back** to MMR + coverage and logs `llmRerank.applied:
false`.

## Consequences

### Positive

- CI catches broken phone routes and broken NDJSON client handling without
  Gemini spend.
- Retrieval fixtures give a repeatable, corpus-dependent check that teams can
  run after ingestion changes.
- LLM rerank cannot take down Q&A: failure modes degrade to the proven path.

### Negative / trade-offs

- E2E still **does not** assert real `/api/ask` streaming against Gemini
  (flaky + costly). That remains Tier 3 or manual QA.
- Vanilla Postgres + `extensions` schema is slightly different from Supabase’s
  hosted defaults; we rely on `search_path` during `db-setup` and expect
  hosted environments to continue working (they already include `extensions`
  on the path).

## Alternatives considered

- **Only Playwright with live LLM** — rejected: rate limits, cost, and
  nondeterminism break PR gating.
- **Tier 2 in default CI** — deferred until we have a free embedding tier or
  canned stub embeddings in CI Postgres.
- **LLM rerank without fallback** — rejected: violates resilience goals for a
  learning project shipping to friends.

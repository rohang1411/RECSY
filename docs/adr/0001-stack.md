# ADR 0001 — Stack choice

Date: 2026-04-19
Status: Accepted

## Context

RECSY v2 must ship on a zero-dollar budget, be maintainable by a single
developer, and serve as a portfolio-grade demonstration of modern retrieval +
LLM engineering. The previous incarnation was a Flutter app with a bespoke
TensorFlow model and static CSV dataset — unusable today.

## Decision

| Concern       | Choice                                                             | Why                                                                                                             |
| ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Framework     | Next.js 16 (App Router)                                            | First-class React Server Components, Route Handlers, edge-friendly; Vercel integration for free-tier hosting.   |
| Language      | TypeScript with `strict` + `noUncheckedIndexedAccess`              | Surface bugs at compile time rather than runtime.                                                               |
| Styling       | Tailwind v4 + OKLCH design tokens                                  | Tailwind v4's CSS-first configuration pairs with OKLCH variables for predictable dark/light theming without JS. |
| UI primitives | shadcn/ui (new-york)                                               | Copy-paste, Radix-based, owns the component source — no hidden upstream drift.                                  |
| DB            | Supabase Postgres + `pgvector` + `pg_trgm`                         | Free tier covers MVP, `pgvector` HNSW for embeddings, hybrid search without extra infra.                        |
| ORM           | Drizzle                                                            | Type-safe schema, migration-first, zero-runtime.                                                                |
| LLM           | Gemini 2.5 Flash (default) + 2.5 Pro (reasoning) via Vercel AI SDK | Generous free tier; AI SDK gives structured-output + streaming out of the box; Groq as a swap-in fallback.      |
| Ingestion     | Python 3.12 with `uv`, `ruff`, `mypy`, `pydantic`                  | Ecosystem strength for YouTube transcripts / Reddit clients; deliberately decoupled from the Next.js process.   |
| Observability | `pino` JSON logs → Vercel log drains; optional Sentry              | Structured logs are enough at MVP scale; distributed tracing is overkill.                                       |
| CI            | GitHub Actions (typecheck + lint + unit + build on PRs)            | Free for public repos; native pnpm + Node support.                                                              |

## Consequences

- One-command local dev (`pnpm dev`) with free cloud peers (Supabase + Gemini).
- All secrets validated at build time via `@t3-oss/env-nextjs`.

* Tailwind v4 + shadcn is still a moving target; we pin exact versions in
  `package.json` to avoid mid-phase regressions.
* Gemini free-tier quotas may bite under load — mitigated by the LLM response
  cache (`services/llm/cache.ts`) and graceful fallback hooks.

## Alternatives considered

- **T3 stack with tRPC** — excellent ergonomics but adds API surface we don't
  need; we already pair Next route handlers with Zod schemas.
- **Next.js + Prisma** — Prisma's runtime is heavier and its migration story
  is less ergonomic than Drizzle for our simple schema.
- **OpenAI GPT-5** — not viable on zero budget; we keep the `LlmProvider`
  abstraction so swapping is a single-file change.

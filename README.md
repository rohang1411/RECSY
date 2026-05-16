# RECSY v2

> Honest smartphone recommendations, grounded in real-world reviews.

[![CI](https://github.com/rohang1411/RECSY/actions/workflows/ci.yml/badge.svg)](https://github.com/rohang1411/RECSY/actions/workflows/ci.yml)
![Node ≥ 20](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)
![License: Internal / Portfolio](https://img.shields.io/badge/license-Internal%20%2F%20Portfolio-lightgrey)
![Free tier](https://img.shields.io/badge/infra-free%20tier-blue)

RECSY v2 is a web-first, AI-native smartphone companion built around one promise: **every claim is traceable to the review clip, thread, or paragraph it came from.**

- **Conversational recommender** — describe your needs in plain English; the pipeline extracts structured requirements, ranks active phones using aspect scores and optional semantic search, and returns your top 3 picks.
- **Per-phone consensus engine** — a 7-axis scorecard (camera, battery, performance, display, build, software, value) aggregated from YouTube, Reddit, and editorial reviews, backed by grounded Q&A with inline citations.
- **Internal Pipeline Observatory** — a gated dashboard (`/internal/pipeline`) that visualizes the entire data lifecycle for presentations and demos.

This is a **portfolio / learning project** demonstrating hybrid RAG, structured-output LLM pipelines, automated ingestion curation, and end-to-end production engineering on free tiers. See [`docs/adr/0001-stack.md`](docs/adr/0001-stack.md) for stack rationale.

---

## Tech Stack

| Layer        | Choice                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Framework    | Next.js 16 (App Router) · React 19 · TypeScript strict                                                                                                                        |
| Styling      | Tailwind CSS v4 · OKLCH semantic tokens · dark-default                                                                                                                        |
| UI           | `next-themes` · `lucide-react` · `motion` · `sonner`                                                                                                                          |
| Database     | Supabase Postgres 17 (`pgvector` · `pg_trgm` · `pgcrypto`)                                                                                                                    |
| ORM / driver | Drizzle ORM · `postgres` (Porsager)                                                                                                                                           |
| LLM SDK      | Vercel AI SDK · `@ai-sdk/google` → Gemini 2.5 Flash/Pro                                                                                                                       |
| Embeddings   | `gemini-embedding-001` · 768 dim (Matryoshka-truncated)                                                                                                                       |
| Ingestion    | TypeScript adapters — `youtubei.js` · `@mozilla/readability` + `linkedom` · Reddit public JSON (Python `yt-dlp` / `youtube-transcript-api` optional transcript fallback only) |
| Logging      | `pino` structured JSON · optional Sentry                                                                                                                                      |
| Testing      | Vitest (unit) · Playwright (E2E)                                                                                                                                              |
| CI / Deploy  | GitHub Actions · Vercel Hobby                                                                                                                                                 |

---

## Quickstart

**Requirements:** Node ≥ 20, pnpm ≥ 9.

```bash
# 1 — install
pnpm install

# 2 — environment
cp .env.example .env.local
# Fill in: DATABASE_URL, DIRECT_URL, SUPABASE_ANON_KEY,
#          SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY

# 3 — bootstrap the database (extensions → migrations → RLS → seeds)
pnpm db:setup

# 4 — start
pnpm dev          # http://localhost:3000

# 5 — quality gates
pnpm typecheck    # tsc --noEmit (strict)
pnpm lint         # ESLint flat config
pnpm test         # Vitest unit suite
pnpm e2e          # Playwright (needs pnpm dev running or uses webServer)
pnpm build        # production build check
```

> **Windows note:** if `pnpm` is not on `PATH` after install, run
> `iwr https://get.pnpm.io/install.ps1 -useb | iex` and restart your shell.

---

## Scripts Reference

### Development

| Script                              | Purpose                                  |
| ----------------------------------- | ---------------------------------------- |
| `pnpm dev`                          | Start Next.js in dev mode on port 3000   |
| `pnpm build` / `pnpm start`         | Production build and server              |
| `pnpm typecheck`                    | `tsc --noEmit` — strict TypeScript       |
| `pnpm lint` / `pnpm lint:fix`       | ESLint flat config (Next + custom rules) |
| `pnpm format` / `pnpm format:check` | Prettier + Tailwind class sort           |
| `pnpm test` / `pnpm test:watch`     | Vitest unit runner                       |
| `pnpm test:coverage`                | Coverage report (v8)                     |
| `pnpm e2e` / `pnpm e2e:ui`          | Playwright browser tests                 |

### Database

| Script             | Purpose                                               |
| ------------------ | ----------------------------------------------------- |
| `pnpm db:setup`    | Full bootstrap: extensions → migrations → RLS → seeds |
| `pnpm db:generate` | Generate SQL migrations from Drizzle schema           |
| `pnpm db:migrate`  | Apply pending migrations                              |
| `pnpm db:studio`   | Drizzle Studio (DB browser)                           |
| `pnpm db:smoke`    | Sanity checks: extensions, tables, HNSW round-trip    |
| `pnpm db:ping`     | Quick connection check                                |
| `pnpm db:reset`    | Destructive reset (requires `RECSY_ALLOW_DB_RESET=1`) |

### Ingestion

| Script                             | Purpose                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------- |
| `pnpm ingest`                      | Single-phone manual ingestion (`--phone <slug> [--adapter …] [--url …]`)              |
| `pnpm ingest:auto`                 | Tiered automated ingestion (`--tier hot\|warm\|cold\|all --shard K --total-shards N`) |
| `pnpm ingest:auto --resume-failed` | Retry quota failures, incomplete runs, and empty-corpus phones                        |
| `pnpm ingest:report`               | Weekly audit digest (adapter/status counts, quota failures, overdue phones)           |
| `pnpm ingest:smoke`                | Live article ingestion end-to-end smoke check                                         |
| `pnpm creator:watch`               | RSS-only poll from `creator_profiles`; enqueues hot-tier candidates                   |

### Scorecard & Embeddings

| Script                     | Purpose                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `pnpm scorecard:run`       | Manual scorecard for a phone (`--phone <slug>` or `--all`)         |
| `pnpm scorecard:auto`      | Automated batch scorecard (`--limit 20 --force --dry-run`)         |
| `pnpm spec-embed:backfill` | Populate `phones.spec_embedding` for the semantic recommender bump |

### Evaluation & Retrieval

| Script                      | Purpose                                                             |
| --------------------------- | ------------------------------------------------------------------- |
| `pnpm retrieval:smoke`      | Live hybrid retrieval sanity check (needs DB + Gemini key)          |
| `pnpm eval:retrieval`       | Fixture-driven retrieval evaluation (embedding cost; local/staging) |
| `pnpm ci:retrieval-fixture` | Seed retrieval eval fixtures for CI                                 |

---

## Repository Layout

```
.
├── src/                     # All application + service code
│   ├── app/                 # App Router pages, layouts, API routes, /internal
│   ├── components/          # Shared UI (AppHeader, PhoneImage, ThemeProvider, …)
│   ├── features/            # Feature slices (phones schema, browse state)
│   ├── services/            # System logic (db, llm, retrieval, chat, recommender,
│   │                        #   ingest, scorecard, internal, logger, rate-limit)
│   ├── lib/                 # Utilities, constants, error types, trace builder
│   ├── styles/              # OKLCH design tokens (theme.css)
│   └── env.ts               # Type-safe environment contract (@t3-oss/env-nextjs)
├── scripts/                 # CLI: db-setup, ingest, scorecard, eval, seeds
├── drizzle/                 # SQL migrations + extension / FTS / RLS helpers
├── fixtures/                # Eval JSON, pipeline replay fixtures
├── e2e/                     # Playwright specs
├── test/                    # Vitest global setup
├── docs/                    # ADRs, operator guides, project context + guide
│   ├── adr/                 # Architecture Decision Records (0001–0017)
│   ├── ImplementationPlans/ # Detailed implementation plans
│   ├── Walkthroughs/        # Narrative walkthroughs for demos
│   ├── retrieval/           # Hybrid retrieval operator guide
│   ├── recommender/         # Recommender operator guide
│   ├── scorecard/           # Scorecard operator guide
│   ├── ingest/              # Ingestion operator guide
│   ├── browse/              # Browse/filter contract
│   ├── compare/             # Compare behavior
│   ├── eval/                # Evaluation tiers and commands
│   └── deployment/          # Deployment runbook
├── public/                  # Static assets (favicons, PWA icons)
└── legacy/                  # Original 2020 Flutter app (reference only; not maintained)
```

Top-level config files stay at the repo root (`package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `prettier.config.mjs`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`) — standard convention so tools and IDEs discover settings without extra flags.

---

## Documentation

| Document                                                               | Purpose                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [`docs/RECSY_V2_PROJECT_GUIDE.md`](docs/RECSY_V2_PROJECT_GUIDE.md)     | Explainer-first narrative — what RECSY is, how every subsystem fits together   |
| [`docs/RECSY_V2_PROJECT_CONTEXT.md`](docs/RECSY_V2_PROJECT_CONTEXT.md) | Living implementation plan, backlog, change log, issues log, development rules |
| [`docs/adr/`](docs/adr/)                                               | Architecture Decision Records (0001–0017)                                      |
| [`docs/ImplementationPlans/`](docs/ImplementationPlans/)               | Detailed implementation plans                                                  |
| [`docs/ingest/README.md`](docs/ingest/README.md)                       | Ingestion operator guide                                                       |
| [`docs/retrieval/README.md`](docs/retrieval/README.md)                 | Hybrid retrieval tuning + debugging                                            |
| [`docs/recommender/README.md`](docs/recommender/README.md)             | Recommender pipeline + API contract                                            |
| [`docs/scorecard/README.md`](docs/scorecard/README.md)                 | Scorecard agent + automation                                                   |
| [`docs/deployment/README.md`](docs/deployment/README.md)               | Deployment runbook and status                                                  |
| [`docs/eval/README.md`](docs/eval/README.md)                           | Evaluation tiers and commands                                                  |

**Key ADRs:**

| ADR                                                                          | Decision                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------- |
| [0001](docs/adr/0001-stack.md)                                               | Stack: Next.js 16, Supabase, Gemini, Drizzle          |
| [0002](docs/adr/0002-design-tokens.md)                                       | OKLCH semantic design tokens                          |
| [0003](docs/adr/0003-ingestion-typescript.md)                                | Ingestion is TypeScript-only (no Python sidecar)      |
| [0004](docs/adr/0004-hybrid-retrieval.md)                                    | Hybrid retrieval: vector + FTS + RRF + MMR            |
| [0006](docs/adr/0006-aspect-scorecard-mvp.md)                                | Aspect scorecard MVP                                  |
| [0007](docs/adr/0007-recommender-mvp.md)                                     | Conversational recommender MVP                        |
| [0011](docs/adr/0011-phone-qa-scope-images-home-ask-trace.md)                | Phone Q&A scope, images, landing cards, ask trace     |
| [0012](docs/adr/0012-recommender-refine-rank-ui-and-empty-corpus-honesty.md) | Recommender refine, rank UI, empty-corpus honesty     |
| [0013](docs/adr/0013-recommender-summary-context-tie-honesty-settings.md)    | Context-aware summaries, tie honesty, client settings |
| [0014](docs/adr/0014-automated-ingestion-curation.md)                        | Automated tiered ingestion with LLM curation          |
| [0015](docs/adr/0015-automated-aspect-scorecard.md)                          | Automated aspect scorecard generation                 |
| [0016](docs/adr/0016-internal-pipeline-observatory.md)                       | Internal Pipeline Observatory dashboard               |
| [0017](docs/adr/0017-ingestion-resumability-and-intelligent-retry.md)        | Ingestion resumability + intelligent retry            |

---

## Status

All phases through Phase 7 (polish) are shipped. Current work: ingestion automation hardening, scorecard automation, and documentation parity. See [`docs/RECSY_V2_PROJECT_CONTEXT.md`](docs/RECSY_V2_PROJECT_CONTEXT.md) for the live backlog, change log, and issues log.

---

## Theming

Dark is the default. Tokens are semantic OKLCH values in `src/styles/theme.css`, exposed via `@theme inline` in `globals.css`. Feature code must never hard-code hex values — use `bg-primary`, `text-muted-foreground`, etc. See [ADR 0002](docs/adr/0002-design-tokens.md).

---

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by `commitlint` on `commit-msg`. Valid scopes are listed in `commitlint.config.mjs`.

```
feat(recommend): add multi-turn preference merging
fix(ingest): handle empty YouTube transcript body gracefully
docs(adr): add ADR 0017 ingestion resumability
```

---

## V1 — Original Flutter Application

_The following documents the original 2020 Flutter-based RECSY application. It lives under [`legacy/`](legacy/) for reference only and is not maintained, wired to CI, or buildable in place._

RECSY was a Flutter mobile app that asked users 6–8 preference questions, fed them to a bespoke Keras / TensorFlow Lite model, and returned a recommended smartphone from a hand-curated ~100-phone CSV. The app was published on the Google Play Store and is available on [APKPure](https://apkpure.com/recsy-ai-smartphone-recommend/com.recsy.mobile_recommender).

### Demo Video

[![Watch the demo](https://img.youtube.com/vi/hhJCmkwLen8/maxresdefault.jpg)](https://www.youtube.com/watch?v=hhJCmkwLen8)

<details>
<summary>Watch via embedded iframe</summary>

<iframe width="560" height="315" src="https://www.youtube.com/embed/hhJCmkwLen8?si=-7wcjBbUngRndcaF" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</details>

### Features

- **Personalized Recommendations** — preference questions fed to an on-device TFLite model.
- **Detailed Phone Specifications** — display, processor, camera, battery.
- **Side-by-side Compare** — compare multiple phones' specs.
- **Favorites** — save phones synced via Firebase.
- **User Authentication** — Firebase Auth + Google Sign-In.

### Tech Stack

- **Framework:** Flutter
- **Backend / Database:** Firebase (Firestore, Realtime DB, Auth, Storage)
- **State Management:** Provider
- **UI:** `carousel_slider`, `dots_indicator`, `fluttertoast`
- **Utilities:** `url_launcher`, `http`, `html`, `xml`, `csv`, `logger`

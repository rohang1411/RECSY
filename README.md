# RECSY v2

Honest smartphone recommendations, grounded in real-world reviews.

RECSY v2 is a rebuild of a 2020 Flutter recommender into a web-first, AI-native
app that combines a conversational recommender with a consensus engine built
from YouTube + Reddit + article reviews. Every claim is traceable to the clip,
thread, or paragraph it came from.

- **Landing page** — chat with a recommender that extracts your needs and picks
  the top 3 phones.
- **Per-phone pages** — a methodology-backed consensus scorecard across seven
  aspects, backed by a conversational Q&A grounded in source citations.
- **Zero budget** — runs entirely on free tiers (Vercel + Supabase + Gemini).

This is a learning / portfolio project. See `docs/adr/0001-stack.md` for the
rationale behind the stack choices.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript strict
- Tailwind v4 with OKLCH design tokens · shadcn/ui (new-york)
- Drizzle ORM → Supabase Postgres with `pgvector`
- Vercel AI SDK · Gemini 2.5 (Flash + Pro) · `text-embedding-004`
- `pino` structured logging · Sentry (optional)
- Python 3.12 ingestion pipeline (`ingest/`) — added in Phase 4

## Quickstart

Requirements: Node ≥ 20, pnpm ≥ 9, Python 3.12 (ingestion only).

```bash
pnpm install

cp .env.example .env.local
# Fill in DATABASE_URL, GEMINI_API_KEY, Supabase keys.

pnpm dev          # http://localhost:3000
pnpm typecheck    # strict TS
pnpm lint         # ESLint + Next rules
pnpm test         # Vitest
pnpm format       # Prettier + Tailwind class sort
```

## Scripts reference

| Script                              | Purpose                                          |
| ----------------------------------- | ------------------------------------------------ |
| `pnpm dev`                          | Start Next.js in dev mode.                       |
| `pnpm build` / `pnpm start`         | Production build and run.                        |
| `pnpm typecheck`                    | `tsc --noEmit` against the strict config.        |
| `pnpm lint` / `pnpm lint:fix`       | ESLint flat config (Next + custom rules).        |
| `pnpm format` / `pnpm format:check` | Prettier with Tailwind class sort.               |
| `pnpm test` / `pnpm test:watch`     | Vitest unit runner.                              |
| `pnpm db:generate`                  | Generate SQL migrations from the Drizzle schema. |
| `pnpm db:migrate`                   | Apply pending migrations against `DATABASE_URL`. |
| `pnpm db:studio`                    | Drizzle Studio (DB browser).                     |

## Repo layout

Top-level **config** stays at the repo root on purpose (`package.json`, `tsconfig.json`,
`next.config.ts`, `eslint.config.mjs`, `prettier.config.mjs`, `drizzle.config.ts`,
`vitest.config.ts`, `playwright.config.ts`, `postcss.config.mjs`) — that is the usual
convention for Node/Next apps so tools and IDEs discover settings without extra flags.

```
.
├── src/                     # Application code (App Router, features, services)
├── public/                  # Static assets served as-is (favicons, etc.)
├── fixtures/                # Non-code inputs: eval JSON, future golden files
├── drizzle/                 # SQL migrations + extension/RLS helpers
├── scripts/                 # CLI: db-setup, ingest, eval, …
├── e2e/                     # Playwright specs
├── test/                    # Vitest global setup (`test/setup.ts`)
├── docs/                    # ADRs, operator guides, project context
├── .github/workflows/       # CI
└── legacy/                  # Pre-rewrite Flutter app (reference only)
```

```
src/
├── app/                     # Routes, layouts, API routes
├── components/              # Shared UI (AppHeader, ThemeProvider, …)
├── features/                # Feature slices (phones schema, etc.)
├── services/                # db, llm, retrieval, chat, recommender, …
├── lib/                     # Small utilities
├── styles/                  # Design tokens (theme.css)
└── env.ts                   # Type-safe environment
```

### `legacy/`

The original 2020 Flutter incarnation lives under `legacy/` for archaeological
purposes. It is **not** maintained, wired to CI, or buildable in place — it
exists so future readers can understand what was replaced and why. Build
artifacts (`.dart_tool`, `build/`, Gradle caches, Xcode derived data, …) are
gitignored from that tree.

## Theming

Dark is the default. Tokens are semantic OKLCH values defined in
`src/styles/theme.css` and exposed to Tailwind via `@theme inline` in
`globals.css`. Feature code should never hard-code hex — use `bg-primary`,
`text-muted-foreground`, etc. See `docs/adr/0002-design-tokens.md`.

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by
commitlint on `commit-msg`. Valid scopes are listed in `commitlint.config.mjs`.

```
feat(recommend): add multi-turn preference merging
fix(chat): preserve anchors when reranking citations
docs(repo): document theme tokens
```

## Status

Phase 0 (scaffold + design system + service skeletons + CI) is complete.
Subsequent phases are tracked in the top-level `.cursor/plans` planning
document. Each phase ends on a green build with updated ADRs.

## Documentation

- **`docs/RECSY_V2_PROJECT_CONTEXT.md`** — live backlog, feature inventory, change log
- **`docs/RECSY_V2_PROJECT_GUIDE.md`** — one-stop narrative for contributors
- **Deployment** — [`docs/deployment/README.md`](docs/deployment/README.md) (full runbook, current status, and missing workflow templates)
- **ADRs** — `docs/adr/`, including PWA/SEO/[`0010`](docs/adr/0010-pwa-seo-analytics-compare.md), phone Q&A / ask trace / [`0011`](docs/adr/0011-phone-qa-scope-images-home-ask-trace.md), and recommender refine / rank UI / empty-corpus / [`0012`](docs/adr/0012-recommender-refine-rank-ui-and-empty-corpus-honesty.md)
- **Retrieval** — [`docs/retrieval/README.md`](docs/retrieval/README.md) (incl. ask trace §9 and empty-corpus behavior §10)
- **Recommender** — [`docs/recommender/README.md`](docs/recommender/README.md) (incl. refine-over-prior-picks)

## License

Internal / portfolio. Not licensed for redistribution yet.

---

## V1 Details

_The following details the original Flutter-based V1 application._

RECSY is a Flutter-based mobile application designed to help users find the best mobile phone based on their preferences. It provides personalized recommendations, detailed specifications, and a comparison feature to assist in making an informed decision.

### Demo Video

[![Watch the demo](https://img.youtube.com/vi/hhJCmkwLen8/maxresdefault.jpg)](https://www.youtube.com/watch?v=hhJCmkwLen8)

<details>
<summary>Alternatively, watch via Embedded Iframe</summary>

<iframe width="560" height="315" src="https://www.youtube.com/embed/hhJCmkwLen8?si=-7wcjBbUngRndcaF" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</details>

### ✨ Features

- **Personalized Recommendations**: Get phone recommendations tailored to your needs.
- **Detailed Phone Specifications**: View in-depth details for each mobile phone, including display, processor, camera, and battery information.
- **Compare Phones**: Compare the specifications of multiple phones side-by-side.
- **Favorites**: Save your favorite phones for quick access later.
- **User Authentication**: Sign in to sync your favorites and preferences across devices.
- **Web & Mobile Support**: Built with Flutter, the app was initially built for android and the support for web platforms is in development. The app was previuosly deployed on the Google Play Store and now it is available on APKPure (Link: https://apkpure.com/recsy-ai-smartphone-recommend/com.recsy.mobile_recommender).

### 🛠️ Tech Stack & Dependencies

- **Framework**: [Flutter](https://flutter.dev/)
- **Backend & Database**: [Firebase](https://firebase.google.com/)
  - **Authentication**: `firebase_auth`, `google_sign_in`
  - **Database**: `firebase_database`, `cloud_firestore`
  - **Storage**: Used for hosting phone images.
- **State Management**: [Provider](https://pub.dev/packages/provider)
- **UI Components**:
  - `carousel_slider`: For image carousels.
  - `dots_indicator`: To display progress for carousels.
  - `fluttertoast`: For simple user notifications.
- **Utilities**:
  - `url_launcher`: To open external links (e.g., 'Buy Now').
  - `http`, `html`, `xml`, `csv`: For data fetching and parsing.
  - `logger`: For application logging and debugging.

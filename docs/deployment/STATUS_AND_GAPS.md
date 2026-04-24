# Status And Gaps

Updated: 2026-04-23

This is the current project snapshot, with a focus on deployment readiness.

## Executive summary

RECSY v2 is in a strong MVP state.

Phases 0 through 6 are shipped. Phase 7 is mostly shipped. The core product is
already present and deployable:

- web app
- database schema and seeds
- ingestion pipeline
- retrieval and grounded phone Q and A
- aspect scorecard
- conversational recommender
- browse and compare
- PWA shell, SEO shell, and analytics

The main remaining work is not "build the product from scratch." It is:

1. finish the missing production automations
2. bootstrap production data completely
3. close the intentionally deferred product follow-ups over time

## What is covered now

### Product surfaces already shipped

- `/` landing page
- `/about`
- `/recommend`
- `/browse`
- `/compare`
- `/p/[slug]`
- `/settings`
- `POST /api/ask`
- `POST /api/recommend`
- `GET /api/health`

### Data and AI systems already shipped

- typed environment validation
- Drizzle schema, migrations, FTS, and RLS
- starter phone corpus and aspect definitions
- TypeScript ingestion adapters
- automated tiered ingestion and creator-watch flows
- hybrid retrieval with vector plus FTS plus RRF plus MMR
- phone-scoped cited Q and A
- aspect scorecard generation
- spec embedding backfill for recommender semantic bump
- multi-turn recommender with refine-over-prior-picks
- honest no-data and tied-score handling

### Frontend and growth surfaces already shipped

- compare page with pickers and direct slug entry
- phone images and spec summary
- installable PWA shell
- sitemap, robots, and default Open Graph image
- Vercel analytics and speed insights

### Quality and CI already shipped

- format check
- lint
- typecheck
- unit tests
- production build
- Playwright E2E
- optional retrieval eval in CI when Gemini secret is present

## What is not covered yet

### Operational gaps that still matter for production

These are the most important missing pieces from a deployment perspective.

1. Automatic production DB rollout workflow is not present in the repo.
   The docs say migrations should be applied on `main` deploy, but there is no
   workflow file today that actually does it.

2. Scheduled scorecard refresh workflow is not present in the repo.
   Ingestion is scheduled, but scorecard generation is still manual.

3. First production data bootstrap is still an operator action.
   The app can deploy before the data is rich enough to feel complete. Someone
   still needs to run `spec-embed`, ingestion, and scorecard once.

4. Single Supabase project model remains the MVP posture.
   Development, preview, and production are conceptually separate, but the docs
   still assume one Supabase project until cost or complexity forces a split.

### Product work that is explicitly deferred

These are real gaps, but they are not blockers for the first production deploy.

1. Offline PWA shell is not implemented.
2. Dynamic per-phone Open Graph images are not implemented.
3. Broader `image_url` backfill is not done.
4. Feedback capture UI and learning loop are not wired yet.
5. Recommender tie-break is still deterministic only.
6. Must-have and deal-breaker handling is still heuristic.
7. Score calibration is not bracket-relative yet.
8. Scorecard still uses one retrieval pass per aspect instead of multi-query
   fusion.
9. Phone chat is streamed as replayed NDJSON output, not token-true streaming.

### Known external limits that docs already accept

1. YouTube transcripts can fail from datacenter or throttled IP ranges.
2. Gemini free-tier limits can become a bottleneck as traffic grows.

## What is covered until now vs not covered until now

### Covered until now

- deployable Next.js application
- deployable Postgres schema and seeds
- scheduled ingestion workflows
- creator RSS watch workflow
- manual new-phone bootstrap workflow
- production-compatible CI and preview deploy posture
- local and CI smoke paths for database and retrieval

### Not covered until now

- automatic DB rollout on `main`
- scheduled scorecard refresh
- fully hands-off first data bootstrap
- offline PWA
- dynamic phone-level OG assets
- richer feedback and evaluation loop

## What is left before calling the project "fully operational"

If the goal is "the product is deployed and keeps itself healthy with minimal
operator work," this is the remaining list:

### Must-do next

1. Add automatic production DB rollout workflow.
2. Add scheduled scorecard refresh workflow.
3. Run the first full production bootstrap:
   `db:setup`, `db:smoke`, `spec-embed`, `ingest:auto`, `scorecard:run --all`.
4. Validate production end to end after the bootstrap.

### Strongly recommended after go-live

1. Expand retrieval eval fixtures.
2. Add Sentry if production monitoring is desired.
3. Decide whether preview and production should still share one Supabase
   project.

### Nice-to-have product follow-ups

1. Offline PWA service worker.
2. Dynamic per-phone Open Graph images.
3. Feedback UI.
4. Smarter recommender tie-break.
5. Better must-have and deal-breaker semantics.
6. Score calibration.

## Detailed steps to finish what is left

### 1. Add automatic production DB rollout

Goal:

- make schema rollout happen from the repo, not from memory

Detailed steps:

1. Create `.github/workflows/db-deploy.yml`.
2. Use the template in [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md).
3. Make sure these GitHub secrets exist:
   `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `GEMINI_API_KEY`.
4. Commit the workflow.
5. Push to a branch and inspect the workflow syntax in GitHub.
6. Manually dispatch it once if you include `workflow_dispatch`.
7. Verify the workflow can run `pnpm exec tsx scripts/db-setup.ts` cleanly.
8. Merge to `main`.
9. Confirm the workflow now runs on every `main` push.

Definition of done:

- no one needs to remember a separate manual DB rollout step after merge

### 2. Add scheduled scorecard refresh

Goal:

- keep `aspects` rows fresh after new corpus data lands

Detailed steps:

1. Create `.github/workflows/scorecard-refresh.yml`.
2. Use the template in [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md).
3. Keep the schedule conservative at first.
4. Use `pnpm exec tsx scripts/scorecard-run.ts --all`.
5. Do not use `pnpm scorecard:run` in GitHub Actions, because it expects
   `.env.local`.
6. Manually dispatch the workflow once.
7. Open a phone page and confirm scorecard rows are still being refreshed.
8. Watch Gemini usage and adjust the cron if needed.

Definition of done:

- ingestion and scorecard are both automated, so the recommender and phone
  pages do not drift behind the corpus

### 3. Run the first full production bootstrap

Goal:

- make the deployed product useful, not just available

Detailed steps:

1. Point local `.env.local` at the production Supabase project.
2. Run `pnpm db:setup`.
3. Run `pnpm db:smoke`.
4. Run `pnpm spec-embed:backfill`.
5. Run `pnpm ingest:auto --tier all --limit 25 --per-phone-limit 5`.
6. If some phones still lack useful corpus coverage, run targeted
   `pnpm ingest --phone <slug>` commands.
7. Run `pnpm scorecard:run --all`.
8. Run `pnpm retrieval:smoke`.
9. Run `pnpm ingest:report --days 7`.
10. Validate the live app on `/recommend`, `/browse`, `/compare`, and at least
    one `/p/[slug]` page.

Definition of done:

- recommendation results use real ranking signals
- phone chat has real citation-backed corpus
- scorecards are visible for phones with ingested evidence

### 4. Close the product follow-ups later

Use this order if you want the best payoff after the deployment work:

1. Feedback UI and feedback loop
2. Recommender tie-break improvements
3. Score calibration
4. Offline PWA shell
5. Dynamic per-phone Open Graph assets

## Known documentation drift

One important doc note:

- the root `README.md` still contains older references such as Python ingestion
  and `text-embedding-004`

For current truth, trust these files first:

- `docs/RECSY_V2_PROJECT_CONTEXT.md`
- `docs/RECSY_V2_PROJECT_GUIDE.md`
- `src/env.ts`
- `.github/workflows/*.yml`
- this `docs/deployment/` folder


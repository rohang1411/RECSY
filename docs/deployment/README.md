# Deployment Docs

This folder is the operator pack for shipping, refreshing, and maintaining
RECSY v2 in a real environment.

## What is in this folder

| File                    | Use it for                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPLOY_EVERYTHING.md`  | End-to-end runbook for provisioning services, bootstrapping data, deploying the app, enabling background jobs, and validating production.          |
| `STATUS_AND_GAPS.md`    | Current project status, what is already covered, what is not covered yet, and what is left before the system feels fully operational.              |
| `WORKFLOW_TEMPLATES.md` | Ready-to-copy GitHub Actions templates for the two main deployment gaps in the current repo: automatic DB rollout and scheduled scorecard refresh. |

## Current deployment shape

- App host: Vercel Hobby
- Database: Supabase Postgres with `pgvector` and `pg_trgm`
- Background jobs: GitHub Actions
- LLM provider: Gemini via `@ai-sdk/google`
- Core bootstrap commands: `pnpm db:setup`, `pnpm db:smoke`,
  `pnpm spec-embed:backfill`, `pnpm ingest:auto`, `pnpm scorecard:run --all`

## Start here

1. Read [`STATUS_AND_GAPS.md`](./STATUS_AND_GAPS.md) to understand what is
   already shipped and what still needs work.
2. Read [`DEPLOY_EVERYTHING.md`](./DEPLOY_EVERYTHING.md) and follow it in order.
3. If you want the repo to manage production hands-off, add the missing GitHub
   workflows from [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md).

## Short version

The application is deployable today, but "deployable" and "fully automated in
production" are not the same thing yet.

The core product is already shipped:

- Next.js app
- database schema and seeds
- ingestion pipeline
- hybrid retrieval
- phone Q and A
- aspect scorecard
- recommender
- browse and compare
- PWA shell, SEO shell, analytics

The main remaining deployment work is operational:

- add an automatic production DB rollout workflow
- add a scheduled scorecard refresh workflow
- run the first production corpus bootstrap and scorecard generation

# Workflow Templates

This file contains ready-to-copy workflow templates for the main deployment
automation gaps that are still missing from the repo.

## 1. Automatic production DB rollout

Suggested file:

`/.github/workflows/db-deploy.yml`

```yaml
name: db deploy

on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: db-deploy
  cancel-in-progress: false

jobs:
  db-setup:
    name: apply db setup to production
    runs-on: ubuntu-latest
    env:
      NODE_ENV: production
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      LOG_LEVEL: info
      SKIP_ENV_VALIDATION: 'false'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10
          run_install: false

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Apply db setup
        run: pnpm exec tsx scripts/db-setup.ts

      - name: Run db smoke
        run: pnpm exec tsx scripts/db-smoke.ts
```

### Why this template uses `db-setup`

It is the safest high-level entrypoint already present in the repo. It handles:

1. extensions
2. migrations
3. FTS SQL
4. RLS SQL
5. seeds

It is also idempotent, which makes it a better operational fit than a custom
one-off chain of commands.

## 2. Scheduled scorecard refresh

Suggested file:

`/.github/workflows/scorecard-refresh.yml`

```yaml
name: scorecard refresh

on:
  schedule:
    - cron: '10 5 * * 0'
  workflow_dispatch:

concurrency:
  group: scorecard-refresh
  cancel-in-progress: false

jobs:
  scorecards:
    name: refresh all scorecards
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      NODE_ENV: production
      DATABASE_URL: ${{ secrets.DATABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
      LOG_LEVEL: info
      SKIP_ENV_VALIDATION: 'false'
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Set up pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10
          run_install: false

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Refresh scorecards
        run: pnpm exec tsx scripts/scorecard-run.ts --all
```

### Why this workflow is weekly by default

`scorecard-run --all` performs multiple retrieval and LLM calls per phone. A
weekly cadence is the safest default on the free tier. If production usage and
Gemini budget allow it, you can later move to a denser cadence.

## 3. Recommended rollout order

If you add these templates, use this order:

1. add `db-deploy.yml`
2. run it manually once
3. add `scorecard-refresh.yml`
4. run it manually once
5. merge both to `main`
6. verify scheduled runs in the Actions UI

## 4. Important implementation notes

1. Use `pnpm exec tsx scripts/...` inside GitHub Actions for scripts that would
   otherwise expect `.env.local`.
2. Keep `SKIP_ENV_VALIDATION='false'` in deployment workflows so configuration
   errors fail fast.
3. Use repository secrets, not committed files, for production values.
4. Reuse the same secret names that the existing ingest workflows already use.

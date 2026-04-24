# Deploy Everything

This document is the full step-by-step runbook for deploying RECSY v2.

It is written for someone who may be doing this for the first time.

If you are new to deployment, read this file from top to bottom once before
running commands.

## What this document helps you do

By the end of this guide, you should have:

| Part | Where it lives | What it does |
| --- | --- | --- |
| Next.js app | Vercel | serves the website and API routes |
| Postgres database | Supabase | stores phones, sources, chunks, scorecards, sessions, cache, and telemetry |
| Background jobs | GitHub Actions | keeps the corpus fresh and runs operator workflows |
| Initial production data | Supabase + scripts | fills embeddings, ingests sources, and generates scorecards |

This guide covers:

- local machine setup
- account and key setup
- Supabase setup
- Vercel setup
- GitHub Actions setup
- first data bootstrap
- production validation
- rollback and recovery
- the extra workflows still missing from the repo

This guide does not implement deferred product work like offline PWA,
feedback UI, dynamic per-phone OG images, or smarter recommender tie-breaks.
Those are tracked in [`STATUS_AND_GAPS.md`](./STATUS_AND_GAPS.md).

## Read this first

### This project is made of four pieces

If you are brand new to deployment, think of the system like this:

1. The code lives in GitHub.
2. The web app runs on Vercel.
3. The database runs on Supabase.
4. Scheduled automation runs on GitHub Actions.

All four pieces need to be configured correctly.

### Terms in plain English

| Term | Plain-English meaning |
| --- | --- |
| repository | the GitHub project that stores the code |
| environment variable | a named configuration value like an API key or URL |
| secret | a sensitive environment variable that should not be shown publicly |
| deployment | a live version of the app running on a host |
| preview deployment | a temporary deployment for a branch or pull request |
| production deployment | the live version users should use |
| workflow | an automated GitHub Actions job |
| cron | a schedule that runs a workflow automatically |
| bootstrap | the first-time setup and data fill that makes the app useful |
| migration | a database schema change applied in a controlled way |
| RLS | Row Level Security, which controls who can read or write DB rows |

### What is safe and what writes to production

If your `.env.local` points at the production Supabase database, these commands
will write to production:

- `pnpm db:setup`
- `pnpm spec-embed:backfill`
- `pnpm ingest`
- `pnpm ingest:auto`
- `pnpm scorecard:run`

These are safer verification commands:

- `pnpm db:ping`
- `pnpm db:smoke`
- `pnpm retrieval:smoke`
- `pnpm ingest:report --days 7`
- `pnpm build`
- `pnpm test`

If you are nervous, do one full practice run against a separate test Supabase
project before pointing `.env.local` at production.

### Final target state

After following this runbook, the finished system should look like this:

| Part | Host | Result |
| --- | --- | --- |
| Website | Vercel | `/`, `/recommend`, `/browse`, `/compare`, `/p/[slug]`, and public metadata routes work |
| API | Vercel | `/api/ask`, `/api/recommend`, `/api/health` work |
| Database | Supabase | schema, RLS, seeds, embeddings, chunks, and scorecards exist |
| Data refresh | GitHub Actions | ingestion and creator-watch workflows run on schedule |
| Operator safety | docs + workflows | DB rollout, scorecard refresh, validation, and recovery are documented |

## High-level deployment order

Follow these steps in order:

1. Prepare your local machine.
2. Clone the repository.
3. Create the Supabase project.
4. Get the Gemini API key.
5. Fill local `.env.local`.
6. Test DB connectivity.
7. Bootstrap the database.
8. Run local checks.
9. Create the Vercel project.
10. Add Vercel environment variables.
11. Add GitHub Actions repository secrets.
12. Run the first production data bootstrap.
13. Validate preview and production.
14. Enable background workflows.
15. Add the two missing production workflows from
    [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md).

## 1. Prepare your local machine

You need these tools on your computer:

| Tool | Why you need it | How to verify |
| --- | --- | --- |
| Git | clone the repo and push commits | `git --version` |
| Node.js 20 or newer | run the app and scripts | `node -v` |
| pnpm 9 or newer | install packages and run scripts | `pnpm -v` |

### 1.1 Check whether the tools already exist

Open PowerShell and run:

```powershell
git --version
node -v
pnpm -v
```

If all three commands print versions, you are ready for the next section.

### 1.2 If `pnpm` is not installed

The repo expects `pnpm`.

Try:

```powershell
corepack enable
pnpm -v
```

If that still does not work on Windows, the project history already documents
the standalone PowerShell installer path:

```powershell
iwr https://get.pnpm.io/install.ps1 -useb | iex
```

Then close PowerShell, open it again, and run:

```powershell
pnpm -v
```

You should see a version number.

## 2. Clone the repository

### 2.1 Clone the repo

Run:

```powershell
git clone <your-repo-url>
cd mobile_recommender
```

If you already cloned it earlier, just change into the repo directory.

### 2.2 Make sure you are in the repo root

Run:

```powershell
Get-Location
Get-ChildItem
```

You should be in the folder that contains:

- `package.json`
- `src/`
- `docs/`
- `.github/`

### 2.3 Install dependencies

Run:

```powershell
pnpm install
```

What success looks like:

- the command finishes without errors
- `node_modules/` exists

## 3. Create the Supabase project

Supabase will host the Postgres database for RECSY.

### 3.1 Create the project

1. Sign in to Supabase.
2. Create a new project.
3. Choose your organization.
4. Give the project a name.
5. Choose a database password and save it somewhere safe.
6. Choose a region close to where you expect to use the app.
7. Wait for the project to finish provisioning.

If some labels in the Supabase UI change slightly over time, look for the
equivalent pages. The important thing is the project itself, not the exact
button text.

### 3.2 Collect the values you will need

You need four values from Supabase:

| Value | What it is | Where you will use it |
| --- | --- | --- |
| Postgres connection string | the DB connection URL | local scripts, Vercel server code, GitHub Actions |
| public project URL | your Supabase base URL | browser and server |
| anon key | public browser-safe key | browser and server |
| service role key | powerful server-only key | server code and automation only |

### 3.3 Find the Postgres connection string

Use the Supabase dashboard and look for the database connection area. The
official docs describe this under the project "Connect" flow and Postgres
connection strings.

Practical steps:

1. Open your project.
2. Look for a `Connect` button or the database connection page.
3. Copy the Postgres connection string that is meant for server-side clients.
4. Save it temporarily in a secure notes app.

Important:

- `DATABASE_URL` is not the same thing as `NEXT_PUBLIC_SUPABASE_URL`.
- `DATABASE_URL` is a Postgres connection string.
- `NEXT_PUBLIC_SUPABASE_URL` is an HTTPS project URL.

### 3.4 Find the project URL and keys

In the Supabase project settings or API area, collect:

1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY`

Save all values safely.

## 4. Create the Gemini API key

RECSY uses Gemini for:

- structured extraction
- chat generation
- embeddings
- scorecard generation
- curation and disambiguation in ingestion

Create a Gemini key in Google AI Studio and keep it safe. You will use it in:

- `.env.local`
- Vercel environment variables
- GitHub repository secrets

## 5. Create local `.env.local`

### 5.1 Create the file

From the repo root, run one of these:

```powershell
Copy-Item .env.example .env.local
```

or

```powershell
cp .env.example .env.local
```

### 5.2 Open `.env.local`

Use your editor of choice and fill in the required values.

At minimum, fill these:

```dotenv
NODE_ENV=development
DATABASE_URL=postgresql://...
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
LLM_PROVIDER=gemini
GEMINI_API_KEY=...
LLM_CHAT_MODEL=gemini-2.5-flash
LLM_REASONING_MODEL=gemini-2.5-pro
LLM_EMBEDDING_MODEL=gemini-embedding-001
LLM_CACHE_ENABLED=true
RETRIEVAL_LLM_RERANK=false
LOG_LEVEL=info
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

### 5.3 What each variable means

| Variable | Meaning |
| --- | --- |
| `NODE_ENV` | local runtime mode; keep this as `development` locally |
| `DATABASE_URL` | Postgres connection string used by Drizzle and server scripts |
| `NEXT_PUBLIC_SUPABASE_URL` | public Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser-safe Supabase key |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only Supabase key |
| `LLM_PROVIDER` | current provider selection; use `gemini` |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `LLM_CHAT_MODEL` | default model for chat and structured output |
| `LLM_REASONING_MODEL` | model reserved for heavier reasoning paths |
| `LLM_EMBEDDING_MODEL` | embedding model for retrieval and spec embeddings |
| `LLM_CACHE_ENABLED` | whether cached LLM responses are enabled |
| `RETRIEVAL_LLM_RERANK` | optional retrieval rerank; usually keep `false` |
| `LOG_LEVEL` | default logging verbosity |
| `NEXT_PUBLIC_SITE_URL` | canonical site URL used by metadata logic |

### 5.4 Keep this file private

Do not commit `.env.local`.

The repo already ignores it.

## 6. Test basic database connectivity

Before running setup, confirm the app can reach the database.

Run:

```powershell
pnpm db:ping
```

What success looks like:

- `[db-ping] connected`
- a role name
- a database name
- a Postgres version
- a latency value

If it fails, stop here and fix the problem before moving on.

Common causes:

- `DATABASE_URL` was pasted incorrectly
- your Supabase project is paused or still provisioning
- your machine cannot reach the DB yet

## 7. Bootstrap the database

This is the first real deployment step.

### 7.1 Run DB setup

Run:

```powershell
pnpm db:setup
```

What this script does:

1. enables required Postgres extensions
2. applies Drizzle migrations
3. applies full-text-search SQL helpers and indexes
4. applies RLS SQL
5. seeds aspect definitions, starter phones, and ingestion profile tables

What success looks like:

- the script prints its numbered setup steps
- it ends with:

```text
[db:setup] OK - all five steps completed.
```

### 7.2 Run DB smoke tests

Run:

```powershell
pnpm db:smoke
```

What success looks like:

- the output shows multiple checks
- there are no `[FAIL]` lines
- the final line reports all checks passed

If `db:smoke` fails, do not continue to Vercel yet.

### 7.3 Important notes

- `pnpm db:setup` is idempotent, so re-running it is safe.
- `pnpm db:reset` is destructive and should not be used on production.
- This repo currently assumes one Supabase project for MVP simplicity.

## 8. Run local quality checks

Before you host anything, make sure the codebase behaves locally.

Run:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

If you also want browser-level verification:

```powershell
pnpm e2e
```

If any of these fail, fix them first.

## 9. Run the app locally once

Start the app:

```powershell
pnpm dev
```

Then open:

- `http://localhost:3000/`
- `http://localhost:3000/about`
- `http://localhost:3000/browse`
- `http://localhost:3000/compare`
- `http://localhost:3000/recommend`
- `http://localhost:3000/api/health`

What you are checking here:

- the app boots
- the environment variables are valid
- routes render without immediate crashes
- the health endpoint is alive

At this stage, some product surfaces may still feel incomplete because the
review corpus and scorecards have not been fully bootstrapped yet.

## 10. Create the Vercel project

Vercel will host the Next.js app.

### 10.1 Import the GitHub repository

1. Sign in to Vercel.
2. Click the flow to create or import a project.
3. Choose the Git repository that contains RECSY.
4. Let Vercel detect that this is a Next.js project.

### 10.2 Check project settings

In the project setup screen or project settings:

1. keep the Root Directory as the repo root
2. keep the framework as Next.js
3. use Node.js 20 or newer if Vercel asks

The repo works with these values:

| Setting | Value |
| --- | --- |
| Install command | `pnpm install --frozen-lockfile` |
| Build command | `pnpm build` |
| Output | normal Next.js deployment |

### 10.3 Add environment variables in Vercel

The official Vercel docs describe this under Project Settings and Environment
Variables.

Practical steps:

1. Open the project in Vercel.
2. Open `Settings`.
3. Open `Environment Variables`.
4. Add each variable one by one.
5. Assign each variable to the correct environments:
   `Preview` and `Production`.

Add these at minimum:

- `DATABASE_URL` (🚨 **Crucial**: Vercel serverless functions require IPv4. You *must* use the **Transaction Pooler URL** (`...pooler.supabase.com:6543`) from your Supabase Dashboard -> Database -> Connection String. If you use the direct `db.rls...` connection string, Vercel will fail with a `getaddrinfo ENOTFOUND` DNS error.)
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`
- `LLM_PROVIDER`
- `LLM_CHAT_MODEL`
- `LLM_REASONING_MODEL`
- `LLM_EMBEDDING_MODEL`
- `LLM_CACHE_ENABLED`
- `RETRIEVAL_LLM_RERANK`
- `LOG_LEVEL`
- `NEXT_PUBLIC_SITE_URL`

Optional:

- `GROQ_API_KEY`
- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `NEXT_PUBLIC_COMMIT_SHA`

Important:

- Do not rely on `.env.local` in Vercel.
- Environment variable changes only affect new deployments.
- If you change values later, trigger a new deployment.

### 10.4 Preview first

Do not treat the first deployment as production.

Create or wait for a Preview deployment first, then open the deployment URL and
make sure it builds and loads.

### 10.5 Add the production domain

Once preview works:

1. open the Vercel project
2. open `Settings`
3. open `Domains`
4. add your production domain
5. update `NEXT_PUBLIC_SITE_URL` so it matches the real production URL
6. redeploy after changing the variable

## 11. Add GitHub Actions repository secrets

GitHub Actions will need secrets so background jobs can reach Supabase and
Gemini.

The official GitHub docs describe this as repository secrets for Actions.

### 11.1 Open the right GitHub page

1. Open the repository on GitHub.
2. Click `Settings`.
3. In the sidebar, open `Secrets and variables`.
4. Click `Actions`.

### 11.2 Add repository secrets

Click `New repository secret` and add these one by one:

- `DATABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GEMINI_API_KEY`

Use the exact secret names above.

If the names do not match, the existing workflows will not find them.

## 12. Run the first production data bootstrap

This is the step many first-time deployers forget.

The app can be deployed before the data is ready, but the product will feel
empty or shallow until these tasks finish.

If your local `.env.local` points at production, the commands below affect the
production database.

### 12.1 Fill `phones.spec_embedding`

Run:

```powershell
pnpm spec-embed:backfill
```

Why this matters:

- the recommender can run without these embeddings
- but the semantic spec bump is only available after this backfill

What success looks like:

- the script ends with a line like:

```text
[spec-embed:backfill] OK - ...
```

### 12.2 Run the first automated ingestion pass

Run:

```powershell
pnpm ingest:auto --tier all --limit 25 --per-phone-limit 5
```

Why these flags:

- the starter seed is about 20 phones
- `--limit 25` is enough to cover the current seed set
- `--per-phone-limit 5` matches the current workflow defaults

What success looks like:

- the script prints how many phones were picked
- each phone prints a summary line
- the script ends with:

```text
[ingest:auto] done successes=... failures=... total=...
```

### 12.3 Optional safe dry run

If you want to see what the script would do before writing data:

```powershell
pnpm ingest:auto --tier all --limit 5 --per-phone-limit 5 --dry-run
```

This is useful for learning the workflow without changing the DB much.

### 12.4 Fill weak phones manually

If some phones still have weak review coverage, use targeted ingestion:

```powershell
pnpm ingest --phone google-pixel-9-pro
pnpm ingest --phone google-pixel-9-pro --adapter reddit --limit 3
pnpm ingest --phone google-pixel-9-pro --adapter article --url https://example.com/review
```

Use this when:

- YouTube transcripts are unavailable
- you want to force a specific article URL
- one phone clearly needs more data than the rest

### 12.5 Generate scorecards

Run:

```powershell
pnpm scorecard:run --all
```

Why this matters:

- ingestion creates `sources` and `chunks`
- scorecard generation creates `aspects`
- both the phone page and recommender benefit from those `aspects` rows

What success looks like:

- each active phone prints an aspect summary line
- the script ends with:

```text
[scorecard:run] OK - ...
```

### 12.6 Run sanity checks after bootstrap

Run:

```powershell
pnpm retrieval:smoke
pnpm ingest:report --days 7
```

What success looks like:

- `retrieval:smoke` prints:

```text
[retrieval:smoke] OK - ...
```

- `ingest:report` prints recent runs, quality snapshots, and overdue phones

Optional:

```powershell
pnpm eval:retrieval
```

Only run `eval:retrieval` if the DB has matching chunks and the Gemini key is
configured.

## 13. Verify the Vercel preview after bootstrap

Once the bootstrap is done, return to the Preview deployment and test it again.

Check:

1. `/` loads
2. `/browse` shows phones
3. `/compare` loads active phones
4. `/recommend` returns picks
5. a phone page loads
6. phone Q and A returns cited answers
7. at least one phone page shows a scorecard

If something looks empty, the most common reason is missing corpus data or
missing scorecards, not necessarily broken UI code.

## 14. Deploy production

Once preview looks healthy:

1. merge your branch to `main`
2. let Vercel create the Production deployment
3. open the production URL
4. repeat the same route checks you used in Preview

Use production only after Preview is already healthy.

## 15. Validate the live production site

Use this exact checklist after the first live deploy:

1. Open `/api/health` and confirm it returns successfully.
2. Open `/` and confirm the landing page renders.
3. Open `/browse` and confirm phones appear.
4. Open `/compare` and confirm the pickers have real choices.
5. Open `/recommend` and ask for a recommendation.
6. Open one seeded phone page and confirm specs render.
7. Ask one phone question and confirm citations appear.
8. Confirm at least one phone page shows a scorecard.
9. Check Vercel logs for runtime or env errors.
10. Check GitHub Actions for workflow failures.

## 16. Enable and test the existing GitHub Actions workflows

The repo already contains these workflow files:

| File | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | quality, Playwright, and optional retrieval eval |
| `.github/workflows/ingest.yml` | manual single-phone ingestion |
| `.github/workflows/ingest-tiered.yml` | scheduled tiered ingestion |
| `.github/workflows/creator-watch.yml` | scheduled metadata polling |
| `.github/workflows/ingest-on-new-phone.yml` | manual bootstrap for new phones |

### 16.1 Open the Actions tab

1. Open the repository on GitHub.
2. Click `Actions`.
3. Confirm the workflows appear.

### 16.2 Manually test each important workflow once

Test them in this order:

1. `ingest.yml`
2. `ingest-tiered.yml`
3. `creator-watch.yml`

Why do this:

- it confirms that secrets are correct
- it confirms the workflow can install dependencies
- it confirms the workflow can talk to Supabase and Gemini

### 16.3 What to expect

- the workflow should show green success
- failures usually mean missing secrets, wrong DB URL, or quota/network issues

## 17. Add the two missing production workflows

Two important deployment pieces are still missing from the repo today:

1. automatic production DB rollout
2. scheduled scorecard refresh

Use [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md) for both.

### 17.1 Add automatic DB rollout

Create:

```text
.github/workflows/db-deploy.yml
```

Use the template from [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md).

Then:

1. commit the workflow
2. push the branch
3. check the YAML in GitHub Actions
4. manually dispatch the workflow once if you kept `workflow_dispatch`
5. confirm `pnpm exec tsx scripts/db-setup.ts` and `db-smoke` succeed
6. merge to `main`

### 17.2 Add scheduled scorecard refresh

Create:

```text
.github/workflows/scorecard-refresh.yml
```

Use the template from [`WORKFLOW_TEMPLATES.md`](./WORKFLOW_TEMPLATES.md).

Then:

1. commit the workflow
2. push the branch
3. manually dispatch it once
4. confirm it can run `pnpm exec tsx scripts/scorecard-run.ts --all`
5. merge to `main`

Important:

- in GitHub Actions, prefer `pnpm exec tsx scripts/...`
- package scripts like `pnpm scorecard:run` expect `.env.local`, which does not
  exist inside GitHub Actions runners

## 18. Troubleshooting guide

### Problem: `pnpm` command not found

Fix:

1. run `corepack enable`
2. if needed, install pnpm with the PowerShell installer
3. open a new PowerShell window
4. run `pnpm -v`

### Problem: `pnpm db:ping` fails

Most likely causes:

- wrong `DATABASE_URL`
- Supabase project is paused or not ready
- network access to the DB is failing

Fix:

1. paste the connection string again carefully
2. verify the Supabase project is running
3. run `pnpm db:ping` again

### Problem: Vercel build fails because env vars are missing

Fix:

1. open Vercel project settings
2. open `Environment Variables`
3. add the missing variables
4. redeploy

### Problem: site loads but phone Q and A says there is no context

This usually means the phone has no ingested chunks yet.

Fix:

1. run `pnpm ingest:auto --tier all --limit 25`
2. run targeted `pnpm ingest --phone <slug>` if needed
3. run `pnpm scorecard:run --all`

### Problem: recommender works but feels weak or tied

Most likely causes:

- `phones.spec_embedding` was never backfilled
- scorecards are missing

Fix:

1. run `pnpm spec-embed:backfill`
2. run ingestion
3. run scorecard generation

### Problem: GitHub Actions workflow fails immediately

Most likely causes:

- missing repository secret
- secret name typo
- invalid DB or Gemini credential

Fix:

1. open repository settings
2. open `Secrets and variables` -> `Actions`
3. compare every secret name against the workflow file
4. rerun the workflow

## 19. Rollback and recovery

### Code rollback

If a deployment introduces bad code:

1. use Vercel rollback to return to the previous healthy deployment
2. fix the code on a branch
3. redeploy cleanly

### Database recovery

If the problem is DB setup or schema related:

1. do not panic and start deleting things
2. prefer a forward fix
3. re-run `pnpm db:setup` if a setup step was interrupted
4. create a compensating migration if the schema itself is wrong

### Missing or stale scorecards

Run:

```powershell
pnpm scorecard:run --all
```

### Missing or stale corpus

Run:

```powershell
pnpm ingest:auto --tier all --limit 25
pnpm ingest:report --days 7
```

### Missing semantic ranking vectors

Run:

```powershell
pnpm spec-embed:backfill
```

## 20. Ongoing operating routine

Use this as the normal maintenance loop after launch.

### Every day

- check failed GitHub Actions runs
- check Vercel runtime logs

### Every week

- run or review `pnpm ingest:report --days 7`
- review phones with weak corpus coverage
- confirm scorecard refresh is still running

### When adding a new phone

1. add the phone row through the normal seed or admin flow
2. run or dispatch `ingest-on-new-phone.yml`
3. run `pnpm scorecard:run --phone <slug>`
4. run `pnpm spec-embed:backfill`
5. verify `/p/<slug>` and `/recommend`

## 21. What this runbook does not solve

This runbook gets the current system deployed and operational. It does not
change the project's known product limits, including:

- no offline service worker
- no dynamic per-phone Open Graph cards
- no feedback capture UI
- no model-based recommender tie-break
- no calibrated score normalization
- no deeper semantic must-have or deal-breaker reasoning
- no guaranteed YouTube transcript coverage from throttled IPs

See [`STATUS_AND_GAPS.md`](./STATUS_AND_GAPS.md) for the current status of
those items and the recommended order for future work.


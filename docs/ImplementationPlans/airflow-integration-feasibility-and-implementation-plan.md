# Airflow Integration Feasibility and Implementation Plan

Date: 2026-06-09

Implementation status: initial scaffold shipped 2026-06-10. The repo now
contains `orchestration/airflow/` with Docker Compose, shared Airflow helpers,
and DAGs for catalog refresh, creator watch, tiered ingestion, ingestion
resume, one-phone ingestion, scorecard automation, reports, and manual
bootstrap. GitHub Actions remains the production scheduler.

## Executive decision

Airflow can be added to RECSY logically, but it should not replace GitHub
Actions as the production automation layer yet.

The best fit is a hybrid, portfolio-friendly integration:

1. Keep GitHub Actions as the production execution engine for scheduled jobs.
2. Add Airflow as an optional orchestration and observability layer under
   `orchestration/airflow/`.
3. Let Airflow either:
   - run the existing `pnpm exec tsx scripts/...` commands locally for demos, or
   - dispatch the existing GitHub Actions workflows through the GitHub REST API.

This gives the project a real data-orchestration story without sacrificing the
current free-tier reliability, secret handling, and low-maintenance GitHub
workflow setup.

Do not add Airflow as a mandatory production dependency until there is an
always-on compute environment that is intentionally managed for Airflow.

## Current automation baseline

RECSY already has a mature automation surface:

- `catalog-refresh.yml`
  - weekly Wikidata/OEM/media refresh
  - monthly MobileAPI sync when the optional secret exists
  - optional Gemini enrichment and spec embedding backfill
- `creator-watch.yml`
  - every 6 hours
  - cheap RSS-only YouTube creator polling
- `ingest-tiered.yml`
  - daily sharded ingestion
  - GitHub matrix across 4 shards
  - transcript fallback tools installed in the runner
  - Gemini, DB, Reddit, and optional YouTube proxy/cookie secrets wired
- `ingest-resume.yml`
  - retries failed, partial, quota-exhausted, and empty-corpus phones
- `ingest-on-new-phone.yml`
  - manual one-phone bootstrap
- `scorecard-auto.yml`
  - daily scorecard queue drain with staleness guard
- `ci.yml`
  - quality gates, build, and Playwright E2E

The existing scripts are good orchestration boundaries:

```text
pnpm catalog:auto
pnpm creator:watch
pnpm ingest:auto --tier all --limit N --shard K --total-shards 4
pnpm ingest:auto --resume-failed --tier all --limit N --shard K --total-shards 4
pnpm ingest --phone <slug> --limit N
pnpm scorecard:auto --limit N --max-runtime-minutes N
pnpm ingest:report --days N
pnpm catalog:report
pnpm db:setup
pnpm db:smoke
pnpm retrieval:smoke
```

Airflow should call these commands. It should not duplicate scheduler logic that
already lives in TypeScript and Postgres.

## What Airflow is actually useful for here

Airflow is useful for RECSY in these areas:

1. Visual DAGs for the data lifecycle
   - catalog discovery
   - creator watch
   - ingestion
   - resume/retry
   - scorecard refresh
   - reporting

2. Better operator controls
   - manually trigger one DAG from a UI
   - pass params like `phone`, `tier`, `limit`, `force`
   - inspect task state without opening several GitHub workflow files

3. Backfills and reruns
   - rerun an ingestion shard
   - rerun scorecards with `force=true`
   - run a one-off "bootstrap production data" DAG

4. Dependency modeling
   - catalog refresh can nudge ingestion
   - ingestion success can be followed by scorecard refresh
   - reports can run after the heavy jobs

5. Portfolio value
   - demonstrates orchestration beyond cron
   - makes the internal pipeline story stronger
   - can be shown beside `/internal/pipeline`

6. Future data engineering use cases
   - retrieval evaluation schedules
   - LLM usage budget reports
   - quality audits for curator rejection reasons
   - stale phone coverage reports
   - source freshness SLAs
   - feedback-loop processing if user feedback is added later
   - offline analytics if clickstream or recommendation feedback is added later

Airflow is not useful for improving the core recommender latency. It is a batch
orchestration tool, not a request-time application dependency.

## What Airflow should not own

Airflow should not own these things initially:

- the Next.js production deployment
- Vercel preview/prod deploys
- PR quality gates
- TypeScript business logic
- phone picking logic
- scorecard freshness logic
- rate limit state
- idempotency rules
- LLM retry semantics
- Supabase migrations as a replacement for the existing DB workflow

Those already live in the repo and database in a more testable form.

## Feasibility verdict

### Technically feasible

Yes. The integration is straightforward because the project already exposes
script-level entrypoints with well-defined flags.

### Operationally feasible on free tier

Partially.

GitHub Actions can remain free or low-cost under the current model. GitHub's
own documentation says standard GitHub-hosted runners are free for public
repositories, while private repositories have plan-specific monthly quotas.
Self-hosted runners are also free from GitHub's billing perspective, although
the machine is still your responsibility.

Airflow itself needs an always-on scheduler, metadata database, webserver/API,
and usually one or more workers. That is the catch. Airflow is free software,
but it is not free to operate unless:

- it runs only locally for demos, or
- it runs on a machine you already control, or
- you accept an unreliable free host, or
- you keep GitHub Actions as the actual production executor.

### Product value

Medium-high as a portfolio and operator experience enhancement.

### Production value today

Low-medium. GitHub Actions is currently simpler, cheaper, and already wired.

### Recommended adoption level

Adopt Airflow as optional orchestration, not as required production
infrastructure.

## Architecture options

## Option A: Do nothing

Keep GitHub Actions only.

### Pros

- simplest
- already works
- no new service
- no Airflow security/secrets/logging burden
- keeps free-tier posture intact

### Cons

- workflow dependencies are spread across YAML files
- less impressive data-orchestration story
- manual backfills and cross-job coordination are clunkier
- Actions UI is job-centric, not data-pipeline-centric

### Verdict

Best for production simplicity. Weakest for portfolio data-engineering value.

## Option B: Local/demo Airflow

Add Airflow under `orchestration/airflow/`, run it locally with Docker Compose,
and let DAGs execute the same `pnpm` scripts against `.env.local`.

### Pros

- demonstrates real Airflow DAGs
- no production hosting cost
- no disruption to GitHub Actions
- can be shown in demos/interviews
- easy to tear down

### Cons

- not a reliable production scheduler
- local machine must be awake
- secrets live locally
- logs are local unless exported
- a failed laptop/Docker state means no scheduled automation

### Verdict

Good first implementation. It adds value without risking the working system.

## Option C: Hybrid Airflow control plane with GitHub Actions execution

Airflow DAG tasks call the GitHub REST API to trigger existing
`workflow_dispatch` workflows. GitHub Actions still does the compute work.

Example:

```text
Airflow DAG task
  -> POST /repos/{owner}/{repo}/actions/workflows/ingest-tiered.yml/dispatches
  -> GitHub Actions runs the existing workflow
  -> Airflow optionally polls workflow run status
```

### Pros

- preserves GitHub secret gates and runner setup
- keeps GitHub-hosted compute
- lets Airflow coordinate and visualize
- no need to rebuild transcript fallback tooling inside Airflow workers
- safer than moving all jobs into Airflow immediately

### Cons

- Airflow still needs an always-on scheduler if it owns schedules
- requires a GitHub token or GitHub App with Actions write permission
- two UIs now exist: Airflow and GitHub Actions
- polling GitHub run status adds API complexity
- failure diagnosis may require opening both Airflow and GitHub logs

### Verdict

Best "serious but still free-tier-aware" architecture. Recommended after the
local/demo version works.

## Option D: Full Airflow production replacement

Run Airflow scheduler/webserver/workers continuously and execute RECSY scripts
directly inside Airflow workers.

### Pros

- one orchestration UI
- native retries/backfills/task dependencies
- easier cross-pipeline dependency modeling
- can centralize logs and run metadata

### Cons

- requires always-on compute
- requires Airflow metadata DB management
- requires secrets management outside GitHub
- requires worker image management with Node, pnpm, Python, yt-dlp, and
  youtube-transcript-api
- risks exceeding free-tier constraints unless self-hosted
- introduces another production system to monitor
- if Airflow is down, scheduled data maintenance is down

### Verdict

Not recommended right now.

## Recommended target architecture

Use a two-mode Airflow setup:

1. `mode=local`
   - Airflow DAGs run `pnpm exec tsx scripts/...` directly.
   - Used for local demos, dry-runs, and development.

2. `mode=github_dispatch`
   - Airflow DAGs trigger GitHub Actions workflows through the GitHub API.
   - Used if you want Airflow to orchestrate production without taking over
     production compute.

The mode can be controlled through an Airflow Variable:

```text
recsy_execution_mode = local | github_dispatch
```

Default should be `github_dispatch` for any non-local environment and `local`
for development.

## Proposed file layout

```text
orchestration/
  airflow/
    README.md
    docker-compose.yaml
    Dockerfile
    requirements.txt
    .env.example
    dags/
      recsy_catalog_dag.py
      recsy_creator_watch_dag.py
      recsy_ingest_dag.py
      recsy_scorecard_dag.py
      recsy_bootstrap_dag.py
      recsy_reports_dag.py
    include/
      recsy_airflow/
        __init__.py
        config.py
        github_actions.py
        operators.py
        commands.py
```

Do not put Airflow metadata inside the application database. Use the Postgres
container from the Airflow Docker Compose stack for local/dev. If production
Airflow is ever added, give it a separate managed Postgres database.

## DAG design

## DAG 1: `recsy_catalog_refresh`

Purpose:

- model the catalog pipeline in task form
- optionally run each stage separately instead of one monolithic script

Schedule:

- weekly lightweight run
- monthly full run
- manual trigger with params

Tasks:

```text
backfill_legacy_identities
  -> discover_wikidata
  -> maybe_sync_mobileapi
  -> prune_candidates
  -> enrich_oem
  -> maybe_enrich_gsmarena
  -> promote_ready
  -> media_backfill
  -> maybe_spec_embedding_backfill
  -> catalog_report
```

Local commands:

```bash
pnpm exec tsx scripts/backfill/canonical-keys.ts
pnpm exec tsx scripts/catalog-refresh.ts --source wikidata --since-years 2 --limit 75
pnpm exec tsx scripts/catalog-sync-mobileapi.ts --since-years 2 --limit 150 --max-requests 50 --min-request-gap-ms 12500 --promote --update-existing
pnpm exec tsx scripts/catalog-prune.ts
pnpm exec tsx scripts/catalog-enrich-oem.ts --from-candidates --limit 25 --promote --update-existing
pnpm exec tsx scripts/catalog-enrich-gsmarena.ts --limit 25
pnpm exec tsx scripts/catalog-promote.ts --ready --limit 50 --update-existing
pnpm exec tsx scripts/catalog-backfill-media.ts --limit 50 --min-request-gap-ms 1250
pnpm exec tsx scripts/backfill-spec-embeddings.ts
pnpm exec tsx scripts/catalog-report.ts --days 35
```

GitHub dispatch target:

- `catalog-refresh.yml`

Notes:

- MobileAPI must stay optional.
- Gemini enrichment must stay optional.
- Monthly vs weekly behavior can be a DAG param instead of separate DAGs.

## DAG 2: `recsy_creator_watch`

Purpose:

- cheap metadata-only feed polling

Schedule:

- every 6 hours if Airflow owns schedules
- manual/demo otherwise

Local command:

```bash
pnpm exec tsx scripts/creator-watch.ts --max-candidates 5
```

GitHub dispatch target:

- `creator-watch.yml`

Notes:

- This job does not need Gemini in practice, but current env validation may
  still require a placeholder key in the GitHub workflow.

## DAG 3: `recsy_ingest_tiered`

Purpose:

- run sharded ingestion

Schedule:

- daily

Task shape:

```text
preflight
  -> ingest_shard_0
  -> ingest_shard_1
  -> ingest_shard_2
  -> ingest_shard_3
  -> ingest_report
```

The shard tasks can run in parallel.

Local commands:

```bash
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 15 --per-phone-limit 5 --fail-on-zero-success --shard 0 --total-shards 4
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 15 --per-phone-limit 5 --fail-on-zero-success --shard 1 --total-shards 4
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 15 --per-phone-limit 5 --fail-on-zero-success --shard 2 --total-shards 4
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 15 --per-phone-limit 5 --fail-on-zero-success --shard 3 --total-shards 4
pnpm exec tsx scripts/ingest-report.ts --days 7
```

GitHub dispatch target:

- `ingest-tiered.yml`

Notes:

- In local mode, Airflow must enforce max parallelism so it does not blast
  external sites or Gemini.
- In GitHub-dispatch mode, keep using the existing GitHub matrix.
- Do not move phone picking into Python.

## DAG 4: `recsy_ingest_resume`

Purpose:

- drain retriable failures and empty-corpus phones

Schedule:

- daily after main ingest, or every 4-6 hours if quota budget allows

Local commands:

```bash
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 20 --resume-failed --fail-on-zero-success --fail-on-empty --shard 0 --total-shards 4
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 20 --resume-failed --fail-on-zero-success --fail-on-empty --shard 1 --total-shards 4
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 20 --resume-failed --fail-on-zero-success --fail-on-empty --shard 2 --total-shards 4
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 20 --resume-failed --fail-on-zero-success --fail-on-empty --shard 3 --total-shards 4
```

GitHub dispatch target:

- `ingest-resume.yml`

Notes:

- This DAG is where Airflow retries can be misleading. The TypeScript script
  already records retryable failure metadata in Postgres. Prefer script-level
  resume logic over blind Airflow retries.

## DAG 5: `recsy_ingest_phone`

Purpose:

- manually bootstrap a newly added phone

Schedule:

- none

Params:

```text
phone: required slug
limit: default 5
```

Local command:

```bash
pnpm exec tsx scripts/ingest.ts --phone "{{ params.phone }}" --limit "{{ params.limit }}"
```

GitHub dispatch target:

- `ingest-on-new-phone.yml`

Notes:

- This is a good candidate for a future internal admin action.
- It should validate that `phone` is present before dispatch.

## DAG 6: `recsy_scorecard_auto`

Purpose:

- drain the scorecard queue

Schedule:

- daily

Local command:

```bash
pnpm exec tsx scripts/scorecard-auto.ts --limit 20 --max-runtime-minutes 38
```

Manual params:

```text
limit: default 20
force: default false
max_runtime_minutes: default 38
```

GitHub dispatch target:

- `scorecard-auto.yml`

Notes:

- Preserve the script's staleness guard.
- Do not use Airflow retries to hammer Gemini after quota errors.
- If `force=true`, require an explicit manual trigger or protected variable.

## DAG 7: `recsy_reports`

Purpose:

- run lightweight operational reports

Schedule:

- weekly

Local commands:

```bash
pnpm exec tsx scripts/ingest-report.ts --days 7
pnpm exec tsx scripts/catalog-report.ts --days 35
pnpm exec tsx scripts/retrieval-smoke.ts
pnpm exec tsx scripts/db-smoke.ts
```

Notes:

- This is low-risk and useful even if heavier jobs stay in GitHub.
- Airflow can store report logs as task logs.
- A later version can persist report snapshots to a DB table for
  `/internal/pipeline`.

## DAG 8: `recsy_production_bootstrap`

Purpose:

- first-run or recovery workflow for a fresh database

Schedule:

- none

Task shape:

```text
db_setup
  -> db_smoke
  -> spec_embedding_backfill
  -> catalog_auto
  -> ingest_tiered_small_batch
  -> scorecard_auto_or_run_all
  -> retrieval_smoke
  -> ingest_report
```

Local commands:

```bash
pnpm exec tsx scripts/db-setup.ts
pnpm exec tsx scripts/db-smoke.ts
pnpm exec tsx scripts/backfill-spec-embeddings.ts
pnpm exec tsx scripts/catalog-auto.ts
pnpm exec tsx scripts/ingest-auto.ts --tier all --limit 25 --per-phone-limit 5
pnpm exec tsx scripts/scorecard-auto.ts --limit 20 --max-runtime-minutes 38
pnpm exec tsx scripts/retrieval-smoke.ts
pnpm exec tsx scripts/ingest-report.ts --days 7
```

Notes:

- Keep this manual-only.
- Add warnings before running against production.
- Do not run destructive DB reset from Airflow.

## Airflow vs GitHub Actions management

## Will it be as easy as GitHub workflows?

For the current project, no. GitHub Actions is easier for production because:

- schedules live in repo YAML
- secrets already live in GitHub
- runners are provisioned automatically
- logs are attached to workflow runs
- workflow_dispatch already gives manual controls
- no scheduler or metadata database must be maintained

Airflow is easier for:

- seeing a full pipeline graph
- rerunning a single failed task in a multi-step pipeline
- running backfills
- passing operator params through a UI
- showing orchestration sophistication

The trade is real: Airflow makes orchestration richer, but operations heavier.

## How would you manage everything?

Recommended management model:

1. Keep production cron in GitHub Actions.
2. Use Airflow for local/demo orchestration and manual workflows.
3. If Airflow needs to orchestrate production, configure it to dispatch GitHub
   workflows rather than execute jobs directly.
4. Keep all operational source of truth in:
   - TypeScript scripts
   - Postgres queue/status columns
   - GitHub workflow secrets
   - docs and ADRs
5. Treat Airflow DAGs as wrappers, not business logic.

Day-to-day operator flow:

- For normal production:
  - check GitHub Actions
  - check `/internal/pipeline`
  - run `pnpm ingest:report` locally if needed
- For a one-off phone:
  - trigger `recsy_ingest_phone` in Airflow or `ingest-on-new-phone.yml` in
    GitHub
- For a quota failure:
  - let `ingest-resume.yml` handle it
  - use Airflow only to manually dispatch or visualize
- For demos:
  - start Airflow locally
  - trigger dry-run DAGs or low-limit DAGs
  - show task graph and logs

## Free-tier implications

## GitHub Actions

GitHub Actions remains the best free-tier execution layer. Public repositories
get standard GitHub-hosted runner usage free, and private repositories get a
monthly quota depending on plan. This matches the existing project posture.

If the repository is private and heavy scheduled workflows exceed included
minutes, costs can appear. The current workflows already try to limit this with:

- conservative schedules
- limits
- sharding
- timeouts
- secret gates
- optional expensive steps

## Airflow

Airflow itself has no license cost. The cost is infrastructure:

- webserver/API
- scheduler
- metadata database
- workers
- log storage
- uptime monitoring
- backups

Local Docker is free but not reliable production. A self-hosted machine is
free from GitHub billing, but not free in maintenance. Managed Airflow is not
free.

## Supabase

Do not use the RECSY Supabase application database as Airflow's metadata DB.
Airflow metadata is high-churn operational state and should be isolated. The
local Docker Compose stack can include its own Postgres container.

## Gemini and external APIs

Airflow does not reduce Gemini/API usage by itself. It can accidentally
increase usage if retries are configured carelessly.

Guardrails:

- keep script-level limits
- keep Gemini free-tier pacing env vars
- use Airflow retries sparingly
- avoid retrying quota-exhaustion immediately
- keep `--max-runtime-minutes`
- keep `--fail-on-zero-success` only where it is operationally meaningful

## Will workflows still use GitHub Actions?

Recommended answer: yes.

The safest implementation keeps GitHub Actions workflows as the production
jobs. Airflow can trigger them through `workflow_dispatch` and optionally poll
for completion.

This keeps:

- GitHub secret gates
- GitHub-hosted runners
- existing workflow YAML
- existing CI/CD behavior
- public-repo/free-runner advantages
- workflow history in GitHub

Airflow then becomes a higher-level control plane, not the only executor.

## Implementation phases

## Phase 0: Decision and guardrails

Deliverables:

- this plan
- an ADR if implementation proceeds

Decision:

- Airflow is optional orchestration.
- GitHub Actions remains production execution.
- No production cron is removed until Airflow has run in parallel for at least
  2 weeks.
- No destructive DB tasks are exposed in Airflow.

## Phase 1: Local Airflow scaffold

Create:

```text
orchestration/airflow/docker-compose.yaml
orchestration/airflow/Dockerfile
orchestration/airflow/requirements.txt
orchestration/airflow/.env.example
orchestration/airflow/README.md
```

Docker image needs:

- Python/Airflow
- Node 20
- pnpm
- project mounted read-only or read-write depending on local needs
- optional `yt-dlp`
- optional `youtube-transcript-api`

Acceptance:

- `docker compose up airflow-init`
- `docker compose up`
- Airflow UI opens locally
- a `recsy_reports` DAG can run `pnpm exec tsx scripts/db-smoke.ts`

## Phase 2: Shared Airflow helpers

Create:

```text
orchestration/airflow/include/recsy_airflow/config.py
orchestration/airflow/include/recsy_airflow/commands.py
orchestration/airflow/include/recsy_airflow/github_actions.py
orchestration/airflow/include/recsy_airflow/operators.py
```

Responsibilities:

- read Airflow Variables:
  - `recsy_execution_mode`
  - `recsy_repo_owner`
  - `recsy_repo_name`
  - `recsy_github_ref`
- read Airflow Connections:
  - `github_recsy_actions`
- build local shell commands consistently
- dispatch GitHub workflows consistently
- optionally poll GitHub workflow run status

Acceptance:

- one helper can run local command mode
- one helper can print or dry-run GitHub dispatch payloads

## Phase 3: Reports DAG

Implement first because it is low-risk.

DAG:

- `recsy_reports`

Tasks:

- `db_smoke`
- `ingest_report`
- `catalog_report`
- optional `retrieval_smoke`

Acceptance:

- local run succeeds against `.env.local`
- task logs show the existing CLI output
- no production schedules changed

## Phase 4: GitHub dispatch support

Implement dispatch mode for:

- `catalog-refresh.yml`
- `creator-watch.yml`
- `ingest-tiered.yml`
- `ingest-resume.yml`
- `scorecard-auto.yml`
- `ingest-on-new-phone.yml`

Acceptance:

- Airflow can trigger a workflow_dispatch run on a test branch
- dispatch includes input params
- workflow URL is logged in the Airflow task log
- GitHub token permissions are minimal

## Phase 5: Core DAGs

Add:

- `recsy_catalog_refresh`
- `recsy_creator_watch`
- `recsy_ingest_tiered`
- `recsy_ingest_resume`
- `recsy_scorecard_auto`
- `recsy_ingest_phone`

Acceptance:

- all DAGs can run manually
- local mode supports low-limit/dry-run operation
- GitHub dispatch mode triggers the existing workflows
- no existing GitHub schedule is removed

## Phase 6: Parallel observation period

Run Airflow in parallel for at least 2 weeks.

Do not let Airflow own production schedules yet.

Compare:

- GitHub run success/failure
- Airflow DAG state
- `ingest_runs`
- `scorecard_runs`
- quota failures
- overdue phones
- operator burden

Acceptance:

- Airflow adds visibility without causing duplicate expensive jobs
- no unexpected extra Gemini usage
- no duplicate ingestion beyond existing idempotent skips

## Phase 7: Optional production control-plane

Only after Phase 6:

- Airflow may become the scheduler for dispatching GitHub workflows.
- GitHub workflows keep `workflow_dispatch`.
- GitHub `schedule` blocks may stay enabled as backup or be disabled one at a
  time.

Recommended if enabling:

1. Move only `recsy_reports` first.
2. Move `creator-watch` next.
3. Move `scorecard-auto`.
4. Move `ingest-resume`.
5. Move `ingest-tiered` last.
6. Keep `catalog-refresh` GitHub-scheduled unless there is a strong reason to
   move it.

## Phase 8: Optional `/internal/pipeline` integration

Future enhancement:

- show latest Airflow DAG run states inside `/internal/pipeline`
- link from internal dashboard to Airflow DAGs
- optionally query Airflow REST API from a server-only internal route

Security:

- never expose Airflow publicly without auth
- never expose Airflow tokens to the browser
- internal dashboard should call a server route that proxies only safe summary
  fields

## Secrets and configuration

## Local mode

Use `.env.local` for RECSY scripts.

Airflow-specific `.env` should include:

```text
AIRFLOW_UID=50000
RECSY_PROJECT_ROOT=/opt/recsy
RECSY_EXECUTION_MODE=local
```

The project env remains:

```text
DATABASE_URL
SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
GEMINI_API_KEY
GEMINI_API_KEY_2
GEMINI_API_KEY_3
GEMINI_API_KEY_4
MOBILEAPI_API_KEY
REDDIT_CLIENT_ID
REDDIT_CLIENT_SECRET
YTDLP_COOKIES_BASE64
YTDLP_PROXY
YTDLP_EXTRACTOR_ARGS
```

## GitHub-dispatch mode

Airflow needs:

```text
recsy_execution_mode = github_dispatch
recsy_repo_owner = rohang1411
recsy_repo_name = RECSY
recsy_github_ref = main
```

Airflow Connection:

```text
conn_id: github_recsy_actions
type: http
host: https://api.github.com
password/token: fine-grained GitHub token or GitHub App token
```

Token permission:

- Actions: write
- Metadata: read

Avoid broad classic PATs if possible.

## Retry policy

Airflow retries should be conservative because the scripts already understand
external API failure modes.

Recommended defaults:

```text
catalog/report/db smoke tasks: retries=1
creator-watch: retries=1
ingest shard tasks: retries=0 or 1
ingest resume tasks: retries=0
scorecard tasks: retries=0
GitHub dispatch API call: retries=2
GitHub run polling: retries handled by sensor timeout, not by re-dispatching
```

Reason:

- retrying a dispatch call can create duplicate GitHub runs if the first call
  succeeded but the response was lost
- retrying scorecards after quota exhaustion burns more quota
- retrying ingestion blindly can re-hit external sites
- script-level resumability is safer than orchestration-level retries

## Concurrency policy

Airflow pools:

```text
recsy_gemini_pool: 1-2 slots
recsy_ingest_pool: 4 slots
recsy_external_http_pool: 2-4 slots
recsy_reports_pool: 2 slots
```

DAG-level:

```text
max_active_runs=1
catchup=False for scheduled production-like DAGs
```

Do not let Airflow run overlapping scheduled ingest and scorecard DAGs unless
the Gemini budget has been reviewed.

## Logging and observability

Current logs:

- local terminal
- GitHub Actions logs
- Vercel logs
- durable Postgres tables like `ingest_runs`, `sources`, and `scorecard_runs`

Airflow adds:

- DAG/task state
- task logs
- manual rerun history
- parameter history

Airflow does not automatically solve central logging. If Airflow runs locally,
logs are local. If it runs in Docker, logs are inside volumes unless configured
otherwise.

Future improvement:

- add a `pipeline_job_runs` table in RECSY for cross-system summaries
- each GitHub workflow and Airflow DAG writes a small durable summary row
- `/internal/pipeline` reads from that table instead of scraping logs

## Problems that can arise

## Duplicate runs

Problem:

- Airflow and GitHub schedules both fire the same expensive job.

Mitigation:

- keep Airflow schedules paused by default
- use `max_active_runs=1`
- keep GitHub workflow concurrency groups
- do not disable GitHub schedules until Airflow has a stable owner
- log every Airflow dispatch with a unique run id

## Quota exhaustion

Problem:

- Airflow retries can multiply Gemini calls.

Mitigation:

- keep TypeScript limits
- keep scorecard staleness guard
- keep hash pre-check
- avoid Airflow-level retries for LLM-heavy tasks
- preserve `ingest-resume` semantics

## Secret drift

Problem:

- secrets exist in GitHub, local `.env.local`, Airflow Variables, and Airflow
  Connections.

Mitigation:

- prefer GitHub-dispatch mode for production
- keep production secrets in GitHub
- only store GitHub dispatch token in Airflow
- use local `.env.local` for local mode only
- document required variables in `orchestration/airflow/.env.example`

## Airflow outage

Problem:

- if Airflow owns schedules and goes down, no data jobs run.

Mitigation:

- keep GitHub schedules as source of truth until Airflow is intentionally
  hosted and monitored
- if Airflow becomes scheduler, leave critical GitHub schedules disabled only
  after there is a fallback runbook

## Metadata DB maintenance

Problem:

- Airflow metadata DB needs migrations, backups, and disk management.

Mitigation:

- isolate it from Supabase app DB
- local/demo mode can discard metadata
- production mode requires backup policy

## Worker image drift

Problem:

- direct Airflow execution needs Node, pnpm, Python, yt-dlp, transcript API,
  and repo dependencies in sync.

Mitigation:

- prefer GitHub-dispatch mode for production
- if direct execution is needed, build a dedicated worker image from the repo
- run `pnpm install --frozen-lockfile` at image build time

## GitHub API dispatch ambiguity

Problem:

- API call succeeds but Airflow loses the response; retry creates duplicate
  workflow runs.

Mitigation:

- include an idempotency-ish run label in workflow inputs where possible
- avoid automatic retries after HTTP timeout unless run existence is checked
- log dispatch payload and response
- optionally use `return_run_details=true` where supported

## Confusing two sources of truth

Problem:

- operators do not know whether to look at Airflow or GitHub.

Mitigation:

- define a mode:
  - "GitHub is production source of truth"
  - "Airflow is demo/control plane"
- document the runbook
- link to the GitHub run from Airflow task logs

## Security exposure

Problem:

- Airflow UI/API contains operational power and secrets.

Mitigation:

- do not expose local Airflow publicly
- require auth if hosted
- use least-privilege GitHub token
- never put Supabase service key in Airflow unless direct local execution is
  required

## Schedule semantics drift

Problem:

- GitHub cron behavior and Airflow cron/data interval semantics differ.

Mitigation:

- set `catchup=False`
- set explicit timezone/UTC assumptions
- avoid depending on Airflow data intervals for RECSY logic
- keep scheduling logic in TypeScript/Postgres

## Disadvantages of using Airflow

1. More infrastructure to understand and maintain.
2. More places for secrets to drift.
3. More logs/UIs to check unless carefully linked.
4. Not free in production unless self-hosted.
5. Local Docker is not production-grade.
6. Retrying LLM/API tasks from Airflow can waste quota.
7. The project may look over-engineered if Airflow is mandatory for a small
   portfolio app.
8. If Airflow replaces GitHub too early, the current simple free-tier setup
   becomes more fragile.
9. Direct execution requires a custom worker image.
10. Airflow metadata DB becomes a new operational dependency.

## What else Airflow could be used for later

1. Nightly retrieval eval on fixtures.
2. Weekly LLM usage/cost report.
3. Curator false-negative audit queue.
4. Source quality drift monitoring.
5. Phone coverage SLA checks.
6. Stale image/media backfill checks.
7. Regional pricing refresh if price data becomes a feature.
8. Feedback-loop processing if users can rate recommendations.
9. Offline recommendation quality benchmarks.
10. Internal pipeline screenshots/report exports for portfolio demos.
11. Dispatching targeted ingestion after catalog promotion.
12. Running low-volume synthetic checks against the live Vercel deployment.

## Recommended final posture

Short term:

- keep GitHub Actions exactly as production automation
- add Airflow local/demo scaffold
- implement `recsy_reports` first
- implement GitHub dispatch mode second

Medium term:

- use Airflow as optional control plane for manual and demo runs
- expose Airflow run links in docs or `/internal/pipeline`
- keep all heavy scheduled production jobs in GitHub

Long term:

- only replace GitHub schedules if there is a reliable always-on Airflow host
  and a reason stronger than "Airflow looks cool"

## Definition of done

Airflow integration is successful when:

- GitHub Actions production schedules still work
- no duplicate expensive jobs are created
- local Airflow can run report and dry-run DAGs
- Airflow can trigger at least one GitHub workflow_dispatch run
- docs explain which UI is source of truth
- secrets are not duplicated unnecessarily
- no production behavior depends on a local laptop
- `/internal/pipeline` can optionally reference Airflow without requiring it

## Official references

- GitHub Actions billing and free usage:
  https://docs.github.com/actions/reference/usage-limits-billing-and-administration
- GitHub scheduled workflow caveats:
  https://docs.github.com/en/actions/how-tos/troubleshoot-workflows
- GitHub workflow dispatch API:
  https://docs.github.com/en/rest/actions/workflows
- Airflow Docker Compose quick start and production warning:
  https://airflow.apache.org/docs/apache-airflow/stable/howto/docker-compose/index.html
- Airflow CLI, Variables, Connections, and environment variable reference:
  https://airflow.apache.org/docs/apache-airflow/stable/cli-and-env-variables-ref.html
- Airflow dynamic task mapping:
  https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/dynamic-task-mapping.html
- Airflow REST API:
  https://airflow.apache.org/docs/apache-airflow/stable/stable-rest-api-ref.html

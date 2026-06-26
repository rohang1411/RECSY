# RECSY Airflow

This folder contains the optional Airflow integration for RECSY. It is a
control-plane and demo layer, not a required production dependency.

The default production automation remains GitHub Actions. Airflow wraps the
existing `pnpm` scripts locally, or dispatches the existing GitHub workflows
when `recsy_execution_mode=github_dispatch`.

## What This Adds

- Visual DAGs for catalog refresh, creator watch, ingestion, resume ingestion,
  scorecards, reports, and bootstrap.
- Manual Airflow-triggered runs with params such as `phone`, `limit`, `tier`,
  and `force`.
- A safe local/demo Airflow environment with its own metadata Postgres.
- A future path to use Airflow as a control plane while GitHub Actions keeps
  doing the actual free-tier compute.

## What This Does Not Replace

- Vercel deployment.
- GitHub Actions CI.
- GitHub Actions production schedules.
- TypeScript/Postgres scheduler logic.
- Ingestion idempotency, retry, and quota handling.

## Quick Start

From this directory:

```bash
cp .env.example .env
docker compose up airflow-init
docker compose up
```

Open Airflow at:

```text
http://localhost:8080
```

Default local credentials come from `.env`:

```text
airflow / airflow
```

The init container runs `pnpm install --frozen-lockfile` into a Docker named
volume, so it does not overwrite your host `node_modules`.

## No-Docker Fallback

If Docker image pulls fail on your network, run Airflow directly in a Linux/WSL
Python virtual environment. Airflow does not run natively on Windows because it
uses POSIX-only modules such as `fcntl`.

```powershell
wsl --install -d Ubuntu
wsl -d Ubuntu
```

Then inside Ubuntu:

```bash
cd /mnt/c/Users/rohan/Documents/RECSY/mobile_recommender/orchestration/airflow
chmod +x ./local-standalone.sh
./local-standalone.sh
```

The script creates `.venv/` and `.airflow-home/` under this folder, installs
Airflow, initializes a SQLite-backed local Airflow metadata database, and prints
the commands for starting the API server and scheduler in two WSL/Linux shells.

If you accidentally run `local-standalone.ps1` on native Windows, it now exits
with the WSL instructions instead of creating a broken Windows Airflow install.

This fallback is for local inspection and manual testing only. It is not a
production scheduler.

## Local Execution Mode

Local mode is the default:

```text
RECSY_EXECUTION_MODE=local
```

In local mode, DAG tasks run the existing package scripts from the mounted repo,
for example:

```bash
pnpm ingest:auto --tier all --limit 15 --shard 0 --total-shards 4
pnpm scorecard:auto --limit 20 --max-runtime-minutes 38
pnpm ingest:report --days 7
```

Those package scripts load `.env.local` from the repository root. Make sure the
repo root contains a valid `.env.local` before running DB, Gemini, ingestion, or
scorecard tasks.

## GitHub Dispatch Mode

Use this mode when Airflow should trigger the existing GitHub Actions workflows
instead of running the scripts itself:

```text
RECSY_EXECUTION_MODE=github_dispatch
RECSY_REPO_OWNER=rohang1411
RECSY_REPO_NAME=RECSY
RECSY_GITHUB_REF=main
```

Then configure one of:

- an Airflow Connection named `github_recsy_actions`, with the token in the
  password field or JSON extra as `{"token": "..."}`;
- or `GITHUB_ACTIONS_TOKEN` in `.env`.

Use a fine-grained token or GitHub App token with the minimum permissions:

- Actions: write
- Metadata: read

Dispatch mode calls the GitHub REST API and logs a link to the repo's Actions
page. It does not currently poll the workflow run to completion; GitHub remains
the source of truth for the job logs.

## DAGs

| DAG                          | Purpose                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `recsy_catalog_refresh`      | Runs `pnpm catalog:auto` locally or dispatches `catalog-refresh.yml`.               |
| `recsy_creator_watch`        | Polls trusted creator RSS feeds or dispatches `creator-watch.yml`.                  |
| `recsy_ingest_tiered`        | Runs four local ingest shards or dispatches `ingest-tiered.yml`.                    |
| `recsy_ingest_resume`        | Runs four local resume shards or dispatches `ingest-resume.yml`.                    |
| `recsy_ingest_phone`         | Manual one-phone bootstrap or dispatches `ingest-on-new-phone.yml`.                 |
| `recsy_scorecard_auto`       | Runs scorecard queue drain or dispatches `scorecard-auto.yml`.                      |
| `recsy_reports`              | Runs DB smoke, ingest report, catalog report, and optional retrieval smoke locally. |
| `recsy_production_bootstrap` | Manual local bootstrap for a fresh/recovered database.                              |

All DAGs are `schedule=None` by default. This is intentional. GitHub Actions
still owns production schedules until Airflow is deliberately promoted.

## Pools

The init service creates these pools automatically:

```text
recsy_gemini_pool: 1 slot
recsy_ingest_pool: 4 slots
```

If you want a more conservative local run, reduce `recsy_ingest_pool` to 1-2
slots in the Airflow UI before triggering ingestion.

## Recommended Workflow

1. Start Airflow locally.
2. Trigger `recsy_reports` first.
3. Trigger low-limit ingestion or scorecard DAGs manually.
4. Keep all production cron schedules in GitHub Actions.
5. Use `github_dispatch` mode only after testing local DAG parsing and a small
   manual dispatch.

## Failure Modes To Watch

- Duplicate expensive jobs if GitHub schedules and Airflow schedules are both
  enabled.
- Gemini quota burn if Airflow retries LLM-heavy tasks.
- Secret drift between `.env.local`, GitHub secrets, and Airflow Connections.
- Local Docker not being a reliable production scheduler.
- Airflow metadata DB growth if logs are never pruned.

The current implementation avoids the biggest risk by leaving every DAG
unscheduled and preserving GitHub Actions as the production source of truth.

## References

- Decision: `docs/adr/0018-optional-airflow-orchestration.md`
- Plan: `docs/ImplementationPlans/airflow-integration-feasibility-and-implementation-plan.md`

# ADR 0018 - Optional Airflow orchestration layer

## Status

Accepted (2026-06-10)

## Context

RECSY already has production-adjacent automation in GitHub Actions:

- catalog refresh
- creator RSS watch
- tiered ingestion
- ingestion resume
- targeted new-phone ingestion
- scorecard automation
- CI and E2E checks

Those workflows are intentionally free-tier friendly. They rely on GitHub-hosted
runners, repository secrets, workflow-level secret gates, conservative limits,
matrix sharding, and script-level retry/idempotency logic.

The project would still benefit from a richer orchestration surface for demos,
manual backfills, operational visibility, and portfolio storytelling. Airflow
is a natural fit for that layer, but making it a required production scheduler
would introduce an always-on service, a metadata database, a worker image, new
secret management, and a second operational UI.

## Decision

Add Airflow as an optional orchestration and observability layer under
`orchestration/airflow/`.

Airflow supports two modes:

1. `local`
   - Runs existing `pnpm` scripts from the mounted repo.
   - Intended for local demos, dry runs, reports, and controlled manual jobs.

2. `github_dispatch`
   - Triggers existing GitHub Actions workflows through the GitHub REST API.
   - Lets Airflow act as a control plane while GitHub Actions remains the
     execution layer.

All Airflow DAGs are unscheduled by default. GitHub Actions remains the
production source of truth for scheduled automation unless a future decision
explicitly promotes Airflow.

Airflow DAGs must wrap existing TypeScript scripts and workflow files. They
must not reimplement phone picking, ingestion idempotency, LLM quota handling,
scorecard freshness, or catalog promotion logic in Python.

## Implementation

New files:

- `orchestration/airflow/docker-compose.yaml`
- `orchestration/airflow/Dockerfile`
- `orchestration/airflow/requirements.txt`
- `orchestration/airflow/.env.example`
- `orchestration/airflow/README.md`
- `orchestration/airflow/include/recsy_airflow/*`
- `orchestration/airflow/dags/*`

Initial DAGs:

- `recsy_catalog_refresh`
- `recsy_creator_watch`
- `recsy_ingest_tiered`
- `recsy_ingest_resume`
- `recsy_ingest_phone`
- `recsy_scorecard_auto`
- `recsy_reports`
- `recsy_production_bootstrap`

## Consequences

### Positive

- Adds a real Airflow integration without risking the working GitHub Actions
  setup.
- Provides visual DAGs for portfolio demos and operator walkthroughs.
- Enables manual one-off runs with params from the Airflow UI.
- Preserves existing free-tier compute through GitHub Actions dispatch mode.
- Keeps business logic in the existing TypeScript scripts and Postgres queues.

### Negative / Trade-offs

- Adds Docker, Airflow, and Python files to a mostly TypeScript repo.
- Adds another local service stack to understand.
- GitHub dispatch mode introduces a second UI for a single logical run:
  Airflow shows dispatch state; GitHub shows execution logs.
- Direct local execution requires `.env.local` and RECSY dependencies inside
  the Airflow container.
- Airflow is not production-free unless it runs locally or on already-owned
  compute.

### Risk controls

- DAGs are paused/unscheduled by default.
- GitHub Actions schedules stay enabled.
- LLM-heavy tasks use conservative retries.
- Airflow pools are created for Gemini-heavy and ingestion-shard tasks.
- Airflow metadata uses its own local Postgres container, not the Supabase app
  database.
- The production bootstrap DAG is manual-only and does not expose destructive
  reset operations.

## Migration / Rollout

1. Keep all existing GitHub Actions workflows unchanged.
2. Run Airflow locally with `RECSY_EXECUTION_MODE=local`.
3. Validate `recsy_reports`.
4. Validate one low-limit local ingestion or scorecard DAG.
5. Configure `github_recsy_actions` only if dispatch mode is needed.
6. Test dispatch mode on a branch or harmless workflow input.
7. Keep GitHub Actions as production scheduler until a separate ADR says
   otherwise.

## References

- Implementation plan:
  `docs/ImplementationPlans/airflow-integration-feasibility-and-implementation-plan.md`
- Airflow local scaffold:
  `orchestration/airflow/README.md`
- Existing automation:
  `.github/workflows/`

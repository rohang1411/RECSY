# ADR 0015 — Automated Aspect Scorecard Generation

## Status

Accepted (2026-05-14)

## Context

ADR 0006 established the MVP for the Aspect Scorecard agent, which retrieves relevant review chunks and extracts structured 0-10 scores per phone axis (camera, battery, etc.). However, it relied entirely on a manual CLI entrypoint (`pnpm scorecard:run`).

As the `phones` catalog expands and the automated ingestion pipeline (ADR 0014) continuously populates new `chunks`, relying on manual triggers to keep scorecards fresh became unscalable. If a phone receives a new batch of YouTube reviews, its scorecard should reflect that new consensus as soon as possible. Conversely, if no new reviews have been published for an older device, running the extraction agent again wastes both time and Gemini API quota.

The goal for this ADR is to introduce an automated, rate-limit-aware scorecard pipeline that:

1. Runs reliably on a schedule without operator intervention.
2. Integrates intelligently with the ingestion pipeline to refresh scores as soon as new data arrives.
3. Completely avoids unnecessary LLM extraction calls if a phone's underlying evidence hasn't changed.
4. Protects our Gemini structured-output free tier quotas (15 RPM).

## Decision

### 1. Dedicated Scheduling and Telemetry Schema

We expanded the database schema to support deterministic scheduling and detailed performance tracking:

- **`phones.last_scorecard_at` & `phones.next_scorecard_at`**: Follows the exact same scheduling pattern established for the ingestion pipeline.
- **`scorecard_runs`**: A new telemetry table capturing granular metrics per phone and aspect run. It stores `status`, `duration_ms`, `score`, `confidence`, and critically, the `chunk_fingerprint` to track staleness.

### 2. MD5 Chunk Fingerprinting (Staleness Guard)

To prevent wasting LLM quota on phones that haven't received new reviews, we implemented an aggressive staleness guard.
`src/services/scorecard/staleness.ts` calculates a lightweight fingerprint of a phone's corpus directly in Postgres using:
`md5(string_agg(id::text, ',' ORDER BY id))` over the `chunks` table.
Before invoking the scorecard agent, the pipeline compares this fingerprint against the last successful run recorded in `scorecard_runs`. If the fingerprint is identical, the agent skips the phone entirely, logging a `skipped (chunks_unchanged)` row.

### 3. Rate Limit Pacing and Error Isolation

The scorecard extraction relies heavily on Gemini's structured output. To prevent hitting the 15 RPM free tier ceiling, `agent.ts` was updated to include a deterministic delay (4.5 seconds) between aspect extractions.
Additionally, errors are now isolated per aspect. If the "battery" aspect fails due to a network glitch or schema violation, the agent gracefully logs the failure to telemetry and continues processing the "display" aspect, rather than crashing the entire phone's run.

### 4. Automated CLI and GitHub Actions Workflow

We created `scripts/scorecard-auto.ts`—a sharded, batch-oriented orchestrator similar to `ingest-auto.ts`. It queries the `pickScorecardPhones` scheduler, evaluates staleness, processes the due phones, and updates their `next_scorecard_at` deadline.
This script is triggered daily at `02:17 UTC` via `.github/workflows/scorecard-auto.yml`, executing asynchronously behind the ingestion cron.

### 5. Post-Ingestion Nudging

The ingestion and scorecard pipelines are decoupled but cooperative. `scripts/ingest-auto.ts` was updated with a post-ingestion hook: if an ingestion run successfully writes new chunks for a phone, it immediately bumps that phone's `next_scorecard_at` deadline to 24 hours from now. This ensures that new evidence is reflected in the UI promptly, without waiting for the default 7-day scorecard refresh cycle.

## Consequences

### Positive

- **Zero-Touch Maintenance**: Scorecards automatically stay synchronized with the ingested review corpus.
- **Cost Efficiency**: The MD5 fingerprinting mechanism saves thousands of redundant LLM calls, protecting the free tier.
- **Resilience**: Per-aspect error isolation and 4.5s pacing ensure the pipeline completes reliably without tripping rate limit alarms.
- **Observability**: The `scorecard_runs` table provides an auditable history of exactly how long extractions take and why they fail.

### Trade-offs

- **Sequential Pacing**: The 4.5s delay means a full 7-aspect scorecard takes roughly ~35-40 seconds per phone. While slow, it is perfectly acceptable for an asynchronous background batch job.
- **Ingestion Delay**: Because scorecards run on their own cron, there is a minor lag (up to 24 hours) between when a new review is ingested and when it affects the phone's score. This is an intentional decoupling to prevent ingestion timeouts.

## Implementation Surface

- `src/services/db/schema.ts` — `last_scorecard_at`, `next_scorecard_at`, `scorecard_runs` table.
- `src/services/scorecard/scheduler.ts` — `pickScorecardPhones`, `markScorecardComplete`.
- `src/services/scorecard/staleness.ts` — Postgres MD5 fingerprinting logic.
- `src/services/scorecard/agent.ts` — Telemetry insertion, aspect delay pacing, error isolation.
- `scripts/scorecard-auto.ts` — Automated pipeline orchestrator.
- `scripts/ingest-auto.ts` — Post-ingestion nudge hook.
- `.github/workflows/scorecard-auto.yml` — Daily cron scheduling.

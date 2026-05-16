# ADR 0017 — Ingestion resumability + intelligent retry

## Status

Accepted (2026-05-15)

## Context

ADR 0014 shipped tiered, automated ingestion with Curator + Disambiguator LLM agents. On the free Gemini tier, a phone with several high-quality sources can exhaust quota mid-run. When that happens:

1. **Missing failure records.** The `ingest_runs` table only logged outcomes from the `discover`-level failure path. Failures inside the per-candidate loop (embed, curator, disambiguator, HTTP fetch) were captured in an ephemeral in-memory `errors[]` array — invisible to the DB. On re-run, there was no way to know which sources had already failed or why.

2. **Re-spending quota on already-written sources.** Because hash pre-checks happened _after_ the LLM curator call, each re-run of a phone paid one curator call + one embed call per source that the writer would eventually skip (same `content_hash` already in `sources`). With 3–5 sources per phone, this doubled or tripled quota consumption on every retry.

3. **No targeted re-run path.** Operators had to re-run the full `ingest:auto` pipeline and hope the quota-failed phones were scheduled within the next tier window. There was no CLI or cron to specifically retry phones that had recorded failures.

4. **Incomplete run rescheduling.** A phone where some candidates succeeded (so `chunksWritten > 0`) was rescheduled as if ingestion completed, stranding the failed candidates until the next full run window (up to 14 days for cold-tier phones).

Full root cause analysis and scenario breakdown: [`docs/ImplementationPlans/ingestion-resumability-and-intelligent-retry.md`](../ImplementationPlans/ingestion-resumability-and-intelligent-retry.md).

## Decision

### 1. Durable per-source failure records

Extend `ingest_runs` to capture failures at every pipeline stage:

| New column        | Type          | Purpose                                                                                     |
| ----------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `stage`           | `text`        | Which stage failed: `fetch`, `chunk`, `curator`, `disambiguator`, `embed`, `write`          |
| `error_code`      | `text`        | Machine-readable error class: `quota_error`, `network_error`, `validation_error`, `unknown` |
| `retry_after`     | `timestamptz` | For `quota_error`: when to retry (parsed from `Retry-After` header or 1 h default)          |
| `candidate_title` | `text`        | Source title at time of failure (URL may be ambiguous)                                      |

Add `phones.last_ingest_status` (`text`, nullable) so operators can query `WHERE last_ingest_status = 'quota_error'` without aggregating `ingest_runs`.

A new `recordFailedRun(db, { phoneId, adapter, url, stage, errorCode, retryAfter, title })` helper writes the failure atomically regardless of where in the per-candidate loop the error surfaced.

### 2. Hash pre-check before any LLM call

Move the `content_hash` check from the writer to the top of the per-candidate loop, _before_ curator and embedder:

```
discover → [for each candidate]:
  compute hash(url + firstChunks) →
    IF hash exists in sources → record "skipped_existing", continue
  fetch → chunk →
  disambiguate (optional LLM) →
  curate (LLM) →
    IF rejected → record "rejected_curator", continue
  embed (LLM) →
    IF quota_error → recordFailedRun, track phones.last_ingest_status="quota_error"
  write
```

This eliminates the two wasted LLM calls per already-ingested source on every re-run.

### 3. `pickResumePhones` + `--resume-failed` CLI flag

Add `src/services/ingest/scheduler/pick-resume-phones.ts`:

- Selects phones with `last_ingest_status IN ('quota_error', 'failed')` or phones that have `ingest_runs` rows with `error_code = 'quota_error'` and `retry_after <= now()`.
- Ordered by `retry_after ASC` (earliest retry window first).
- Respects the per-run `--limit` cap.

Wire as `--resume-failed` flag in `scripts/ingest-auto.ts`, replacing the normal `pickPhones` selector.

### 4. `ingest-resume.yml` cron

A lightweight GitHub Actions workflow (`.github/workflows/ingest-resume.yml`) runs every 4 hours to drain the quota-error backlog using `pnpm ingest:auto --resume-failed --limit 3 --tier all`. It is separate from the nightly hot/warm/cold cron so quota recovery does not block new-phone ingestion.

### 5. `ingest:report` enhancements

`pnpm ingest:report` now includes:

- **Quota failure section** — phones with `last_ingest_status = 'quota_error'` and their `retry_after` timestamps.
- **Status distribution** — counts by `last_ingest_status` across the catalog.
- **Overdue phones** — phones where `next_ingest_at <= now() - interval '2 days'`.

### 6. `pnpm db:migrate` reads `.env.local`

Convenience DX improvement: `drizzle.config.ts` now reads `.env.local` in addition to `.env`, so operators can run `pnpm db:migrate` without exporting `DATABASE_URL` separately.

## Consequences

**Positive**

- Every pipeline failure is now durable and inspectable in the DB.
- Re-runs of quota-failed phones skip already-ingested sources at DB-read cost only (no LLM calls).
- Operators can see the full quota failure backlog with `pnpm ingest:report` and drain it with `pnpm ingest:auto --resume-failed`.
- Cold-tier phones that hit quota recover within 4 hours rather than waiting up to 14 days for the next scheduled window.

**Negative / Trade-offs**

- Schema additions (`ingest_runs` new columns, `phones.last_ingest_status`) require a migration and a `db:setup` re-run on existing environments.
- `pickResumePhones` adds a second scheduler path to maintain; operators must understand when to use `--resume-failed` vs. normal `--tier`.
- The hash pre-check requires fetching enough of the source to compute the hash before curator, slightly increasing HTTP traffic on re-runs (vs. the previous skip at write time).

## Migration

`drizzle/migrations/0004_equal_sauron.sql` — adds columns to `ingest_runs` and `phones`. Migration is forward-only and idempotent (`IF NOT EXISTS` on new indexes). Run with `pnpm db:migrate`.

## References

- Implementation plan: [`docs/ImplementationPlans/ingestion-resumability-and-intelligent-retry.md`](../ImplementationPlans/ingestion-resumability-and-intelligent-retry.md)
- Fix commits: [`59edc99`](https://github.com/rohang1411/RECSY/commit/59edc99) (CI gate), [`c4724d8`](https://github.com/rohang1411/RECSY/commit/c4724d8) (secrets gate), [`18cdd6d`](https://github.com/rohang1411/RECSY/commit/18cdd6d) (ingestion hardening)
- Context doc: §13 (audit trail), §22 (2026-05-15 change log entries), §23 (ops hardening issues)
- Project Guide: §2 (ingestion subsystem), §16 (reading order)
- Precedes this ADR: [ADR 0014 — Automated tiered ingestion with LLM curation](./0014-automated-ingestion-curation.md)

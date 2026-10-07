# Catalog Hygiene And Retry Audit

## Correction: Individual Models Restored

The requested exclusion was the single combined candidate `Apple iPhone 18 Pro and iPhone 18 Pro Max`, not either individual model. The original archival mistakenly excluded both individual phones. That operation has been corrected in the configured database: both existing phone IDs are active again, their four individual candidate records are reconciled to the existing phones, and the 11 source rows disabled by that operation are active again. Existing specs, scorecards, evidence, embeddings, and completed queue history were retained.

The combined candidate remains excluded as `non_phone_device`. The archival script no longer has a hardcoded exclusion for either individual model; a regression test distinguishes both individual titles from the combined title. Current live verification finds 74 active phones, zero archived phones, and 11 excluded reference candidates. Recommendation and pipeline phone counts agree.

## Verified Root Causes

- Title eligibility accepted bare product families and combined models. Records already tagged `non_phone_device` were not consistently excluded from dashboards or workers.
- Catalog pruning reset ordinary priority-brand failures to immediately retryable state. Enrichment selected brand/date before attempt history, allowing repeatedly failing entries to dominate. The old long-tail pruning rule also shelved lower-priority brands instead of allowing fair retries.
- Repeated discovery could overwrite extracted claims and retry state. Identity-only discovery also queued models whose schema-valid canonical phone already existed.
- Ingestion treated a clean unchanged-content pass as failure, leaving the phone immediately due. Its old hash guard ran after model-based disambiguation.
- Manual scorecard generation did not share the automatic workflow's corpus fingerprint guard. Unchanged catalog promotion also cleared spec embeddings unnecessarily.
- Shared Wikipedia articles could deterministically assign base-model fields to a sibling variant. The fallback prompt did not identify the exact requested model.

## Changes And Applied Database Work

- Migration `0010_archive_phone_status.sql` adds an `archived` phone status. Applied to the configured database after checking migration state.
- Excluded product families and combined-model candidates, retaining original rows for reference. The mistaken individual-model archival was reversed as documented above. Sources and queue items for genuinely archived phones remain disabled.
- The Database Dashboard's `Excluded / Non-Phones` filter is the reference view. Ordinary catalog lists, reason breakdowns, ingestion health, lifecycle options, pipeline device details, recommendations, and worker selection exclude archived records. Historical global LLM usage and workflow resource totals remain truthful; past expenditure is not erased.
- Reconciled 18 identity-only pending candidates to unique exact, schema-valid existing phones without source fetching or model calls. This does not promote incomplete new phones or import invalid source claims.
- Enrichment honors due times, orders by attempts and oldest attempt before brand/recency tie-breakers, and records attempts even on unsuccessful fetches. Discovery preserves claims and cooldowns. Legacy long-tail exclusions can be released once; normal failures are no longer reset by pruning.
- OEM attempts have a source-specific cooldown so an unsuccessful official-page attempt does not suppress Wikipedia fallback on the original discovery candidate.
- Clean unchanged ingestion is successful when usable evidence exists; empty/error outcomes receive a schedule instead of remaining immediately due. Resume selection respects phone cooldowns and ignores failures superseded by later successful/skipped processing of the same URL.
- Unchanged active source content skips disambiguation, chunking, curation, and embeddings. All scorecard entry points compute/check the corpus fingerprint before retrieval or extraction, unless explicitly forced. Unchanged catalog spec inputs retain spec embeddings.
- Wikipedia deterministic extraction is allowed with zero LLM budget. Shared-article variant extraction is model-specific; a missing requested variant is rejected before any model call. Zero-budget extraction is deferred explicitly rather than reported as absent source data.
- Dashboard promoted rows are deduplicated by canonical phone; the All Entries count matches its rows. Deferred/skipped candidates are not labelled as actively processing.
- Required dashboard queries are bounded and loaded in smaller groups. A failed inventory query produces a visible unverified-data warning instead of caching partial rows as a successful response.

## Validation Boundaries

After the correction, live queries verified 74 active phones, zero archived phones, 11 excluded reference candidate rows, and agreement between pipeline phone counts and recommendation eligibility. No active phone had an empty corpus at inspection. Existing failed ingestion status flags were not blanket rewritten; subsequent correctly classified worker runs will update them. The earlier 72-active/two-archived snapshot reflected the mistaken archival, not the intended exclusion policy.

At inspection, 34 candidates remained pending: 31 identity-only discovery rows without a spec projection and three extraction-budget deferrals. Other source records remained blocked for implausible values, absent required fields, missing source pages, or deferred release evidence. A discovery identity alone cannot satisfy the catalog spec contract. Validation was not weakened to invent missing data.

A live three-candidate enrichment pass with `--max-llm-calls 0` completed with zero model calls and deferred candidates requiring structured extraction. Unit tests use deterministic fixtures/mocked providers; they establish guards, not the factual accuracy of every catalog phone. Desktop/mobile browser checks establish archive filtering and layout, not a deployed production release.

## Diagnostics

Focused verification: 127 tests across 27 files passed, along with TypeScript checking, scoped ESLint checks, and desktop/mobile browser inspection. This is not a full production ingestion campaign.

From the repository directory:

```powershell
pnpm exec tsx --env-file=.env.local scripts/catalog-audit.ts --verify
pnpm catalog:report --days 7 --names-limit 20
pnpm ingest:report --days 7
```

`catalog-audit` prints candidate status/reason counts, actual recorded LLM events grouped by feature, and assertions for dashboard/recommendation/worker exclusions. A skipped pipeline run is not evidence that an LLM request occurred; inspect `llm_usage_events` and feature attribution separately.

Archival is dry-run by default:

```powershell
pnpm exec tsx --env-file=.env.local scripts/catalog-archive.ts
```

For another deployment/database, apply the migration before archival and deploy the updated filters/workers together. The code changes must be published before GitHub Actions and hosted dashboards use these fixes. Existing unrelated evaluation work in the checkout was preserved.

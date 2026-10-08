# Evaluation operator guide (2026-10-06)

This guide describes the checked-in evaluator and current campaign. A passing stub or component run does **not** establish recommendation quality, answer truth, API capacity, or production readiness. Use [plan 21](../ImplementationPlans/21.%20production-evaluation-campaign.md) and the [executed evidence report](PRODUCTION_CAMPAIGN_2026-10-06.md) for current status; plan 20 preserves earlier findings.

## Complete local campaign

Requirements: Node 20+, pnpm, installed project dependencies and `.env.local` with the DB connection. Database privileges must permit a new `eval_` schema, migrations and catalog/corpus reads. The script copies catalog/corpus, not production sessions, queries or cache. It uses loopback ports 3100/3210 and fails with an explicit startup/log error if those ports or configuration are unavailable. Docker is not required. These schemas share the database host; runs are not physically isolated production capacity tests.

```powershell
# First preparation: create a fresh schema from migrations and copy catalog/corpus.
pnpm eval:campaign --new-stage
# Repeat complete HTTP functional/fault checks and the bounded load sweep.
pnpm eval:campaign --load
# Short workflow smoke check; not a load acceptance campaign.
pnpm eval:campaign --load --quick
# Keep the isolated portal available for inspection; Ctrl+C shuts down owned servers.
pnpm eval:campaign --serve-only
# Optional browser smoke (requires installed Chrome and a prepared campaign).
pnpm eval:portal:smoke
# Build first, then verify production access/error behavior locally without generation.
pnpm build
pnpm eval:production:smoke
```

The campaign starts a controlled provider automatically, checks actual API persistence and terminal stream events, restores injected DB/phone changes, saves per-case evidence and logs, and shuts down its owned process trees. It leaves the named schema and evidence artifacts for review. Tests do write synthetic clients/turns/chat records to that schema. A spike can fail; nonzero exit and the raw artifact are expected diagnostics, not a reason to erase failed attempts. Load schedules arrivals independently of response speed, counts drops, and checks stated local p95/error objectives. Code-content hashes and a final source-integrity check identify changes during execution. Keep load separate from builds, other benchmarks and code edits.

For the live source-backed candidate pilot:

```powershell
$stage = Get-Content output/eval/current-stage.json -Raw | ConvertFrom-Json
$env:DATABASE_SCHEMA = $stage.namespace
pnpm eval:quality                 # prepare only; no model requests
pnpm eval:quality --live          # capped diagnostic pilot
pnpm eval:review                  # build blinded HTML and review template
pnpm eval:review:import C:\path\to\exported-review.json
```

The capped pilot permits at most 20 actual generation requests and 12 embedding requests, SDK retries zero, at most two configured keys, and stops on the first quota 429. A previous quota stop blocks a casual rerun: verify reset in AI Studio before explicitly adding `--after-quota-reset`. Each execution is a separate artifact; do not combine runs from different code/model/corpus versions into one headline. The portal's historical live evaluator also uses transport caps (20 generation/40 embedding requests), so a full authored suite can stop before completion. Limits are conservative evaluation budgets, not an assertion about Google's account quotas. The actual 2026-10-06 pilot was interrupted by 429 after one successful answer; no further live calls are currently authorized by an assumed quota reset.

Open `http://127.0.0.1:3100/internal/eval` during `--serve-only`. **Load campaign evidence**, **Download blinded review**, and **Import review labels** use the local campaign artifacts. Review labels are checked against the exact run/result/corpus hashes and question/answer IDs; uncertain/missing labels remain unresolved. The small candidate pilot is ineligible for a resume percentage even after review. Campaign artifacts are local and are unavailable on the deployed server unless a separate artifact-storage workflow is built; the portal reports that limitation.

Evidence is saved under `output/eval/<schema>/` and ignored by Git. Preserve its corpus, run manifests/results, HTTP evidence/logs, review HTML/labels and private variant map. Give the reviewer the HTML, not the private map or model scores. `pnpm eval:corpus` refreshes the source snapshot; `pnpm eval:corpus:audit` reports coverage, dates, model labels, vector fingerprint and planner statistics. None of these checks establish source truth. `pnpm eval:snapshot` exports the six complete catalog/corpus tables, including embedding bytes and spec/aspect data, without user/session/cache records. For replay on a new empty schema, use `pnpm eval:stage --empty`, then `pnpm eval:snapshot --restore=<absolute-snapshot-path>`; restoration verifies table hashes, refuses nonempty targets, inserts in one transaction and analyzes tables. Keep the prior stage pointer/artifacts before creating a new stage. On a stage with no corpus, ingest real verified sources before a positive quality benchmark; do not use seeded/stub documents as real product evidence.

## Run it

Review package version 2 uses randomized, persistent answer IDs and independently requires factual correctness and support by citations. Sources can contain false claims or outdated software behavior. Validate OEM specifications, device/region and dates where applicable; use uncertain when verification is incomplete. The four reviewed false USB passages listed in `fixtures/eval/source-quality-issues.json` are quarantined by local hybrid retrieval before fusion. This targeted policy is not an exhaustive corpus-truth classifier. The old live pilot remains immutable; do not imply its outputs used repairs made later. Use the current `review.html` and rubric v2 when returning labels; older exports lack the required truth decision.

1. Configure `.env.local` with the project database connection. For live generation, configure the model provider credentials as well. Start with `pnpm db:ping` if connectivity is uncertain.
2. Run `pnpm eval:check --suite=recsys --sample=full` (or `rag`, `multi-turn`, `load-stress`, `all`; `quick` selects the first five authored cases). The command validates fixture structure and IDs, checks live schema/catalog/corpus prerequisites, and fails before creating a run when they are missing.
3. Run `pnpm eval:benchmark --suite=recsys --sample=full --track=stub`. `--track=live` is available for `rag` and `multi-turn` only. Stub is the default and is a development check. A live run can spend provider quota and cannot be inferred from a stub run.
4. Inspect a stored run with `pnpm eval:report --id=<run-id>` or open `/internal/eval`, select a suite, sample, and provider track, click **Check readiness**, then run. `pnpm eval:benchmark --suite=load-stress --sample=quick --track=stub --vus=5 --total=25` is a bounded database retrieval probe. The separate `pnpm eval:load` entry point is also a component probe. Neither sends HTTP traffic to the product routes.

The portal reports preflight errors, run failures, nonpassing cases, and run provenance. For a retrieval probe it displays target chunk count, successful goodput, completed-attempt latency, stage p95 values, and error counts. The largest stage p95 is an investigation lead, not proof of a database bottleneck without server traces. Its history is stored in `benchmark_runs` and `benchmark_results`; an unavailable database produces an error rather than an empty-history success. In production, set `INTERNAL_DASHBOARD_ENABLED=true` and a strong `INTERNAL_EVAL_TOKEN`, then enter that token in the portal. Evaluation APIs reject requests without the token. Restrict access to trusted operators: runs use the project database and may call a live provider.

The run record includes fixture SHA-256 hashes, catalog fingerprint and count, selected track/model, code commit and dirty-tree state, sample, measurement boundary, timestamps, status, per-case traces, and errors. For a comparison, use runs with the same suite, track, fixture hashes and catalog fingerprint. A dirty working tree cannot be reconstructed from its commit hash alone. Imported JSON is marked unverified and is not execution evidence.

For Q&A, inspect vector/FTS hit counts and stage errors per case. The five-case quick probe on this database returned vector chunks in every case and zero FTS chunks in every case. This is a coverage diagnostic, not proof that adding FTS hits would improve relevance. The generation panel distinguishes cache hits from uncached provider calls and reports only current-run usage that the provider actually returned; cached historical usage is not current-run spend.

## What the current suites measure

| Suite         | Measurement boundary                                                                               | Interpret with care                                                                                                                                                                                                                                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recsys`      | Production catalog loaded from Postgres, ranked in memory against 30 authored personas             | Returned-pick budget/dealbreaker checks are useful regressions. MAUT NDCG@3 and MRR reuse ranking signals to derive relevance; they measure ranker agreement, not independently judged shopper relevance. Empty results fail answerable cases; the impossible foldable case explicitly expects no result and is excluded from ranking/CSR denominators. |
| `rag`         | Retrieval plus answer generation for 20 authored answerable questions                              | Citation IDs, lexical overlap and numeric string checks are proxies. They do not establish factual entailment, fully supported answer rate, or ALCE equivalence. The 10 authored unanswerable cases are quarantined and not executed as an abstention benchmark.                                                                                        |
| `multi-turn`  | 15 authored trajectories, 37 turns, extraction/merge/ranking path with the selected provider       | Binary JGA checks only annotated slots. Retention, immediate mutation responsiveness, refine F1, and reset checks use eligible annotated turns; absent denominators are unavailable. Provider token counts require complete coverage. The schema mismatch is repaired locally; one hard-exclusion fixture still requires independent review.            |
| `load-stress` | Concurrent database retrieval of an active phone with chunks, using a deterministic query embedder | Reports actual completed attempts, successful goodput, errors, latency percentiles, and retrieval stage times. It does not measure HTTP/API capacity, generation, provider quota, or database pool saturation.                                                                                                                                          |

`all` runs recsys, rag, and multi-turn; it does not include load-stress. The historical `--suite=ablation` and `pnpm eval:stress` commands do not exist in this checkout. `pnpm eval:retrieval` is a separate older smoke-style evaluation described below.

## Dataset and current blockers

The fixtures in `fixtures/eval/` are authored development data. They have not been independently adjudicated, double-reviewed, or frozen as a held-out product-quality benchmark. The recommendation/Q&A fixture is versioned `2.1-dev`; 29 arbitrary NDCG target values and 20 citation target values were removed because they were hand-entered and unused. Its `referenceFacts` entries are largely keywords, not independently checked answer facts. A benchmark cannot be guaranteed perfect. The current preflight validates machine-checkable structure and database coverage; it cannot certify that labels, facts, prices, or source passages are true.

On 2026-10-05 the connected database had 74 active US catalog phones. Full Q&A preflight failed: `cmf-phone-1` was missing from the phone table, while `nothing-phone-2a`, `google-pixel-8a`, `oneplus-open`, and `samsung-galaxy-s24` had no chunks. Ingest verified evidence for these cases or revise the fixture with independent review, then rerun preflight. Do not silently drop missing cases or count them as successes. Quick Q&A preflight covered only its first five cases and passed; that says nothing about the remaining 15.

The `client_id` mismatch found on 2026-10-05 is repaired locally: restored original migration 0009/hash and models, atomic owner/session creation, and serialized turn persistence. Multi-turn preflight passes and real HTTP session checks run in fresh staging. The local full authored component suite currently reports 14/15; the remaining exclusion fixture needs review because the catalog cannot verify bloatware/slow-charging exclusions and the product clarifies. Full Q&A coverage still fails for the five historical fixture phones above. Deployed behavior must be reverified after publishing the repairs; local success does not update the remote site.

## Failure triage

| Preflight or run stage      | First check                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixture`                   | JSON path and case ID in the error; repair invalid shape, duplicate IDs, or turn order, and review any changed label.                              |
| `database schema`           | Compare the actual database and migration hashes with the restored models/session writer; verify `DATABASE_SCHEMA` and required owner FK.          |
| `catalog` or `corpus`       | Verify active US phones and ingested chunks for every selected Q&A phone. Missing corpus is an ingestion/fixture issue, not an answer-model score. |
| `retrieval`                 | Inspect vector, FTS, fusion and MMR stage timings plus underlying error details. A degraded vector or FTS path fails the load probe.               |
| `generation` or `provider`  | Inspect provider identity, credential/quota/timeout error, and per-case trace. Stub output never substitutes for a failed live call.               |
| `metric` or nonpassing case | Review the input, expected annotated fields, actual picks/answer, and metric denominator. Do not turn an unverified proxy into a quality claim.    |

## Release rule

For resume claims, cite an exported run with exact environment, catalog and fixture hashes, provider/model, case denominator, failures, and boundary. The current synthetic cases and self-derived or lexical scores are not defensible customer-quality results. A production-readiness decision additionally needs a reviewed held-out dataset, live API tests, a controlled load sweep, fault/abuse cases, observability, deployment and incident evidence. These gates are open in the [plan](../ImplementationPlans/20.%20evaluation-validity-and-operations-repair.md).

## Hybrid retrieval — `eval:retrieval`

Script: `scripts/eval-retrieval.ts`  
Fixtures: `fixtures/eval/retrieval-fixtures.json`

Runs hybrid search (vector + FTS + RRF, etc.) for each fixture’s `phoneSlug` and `query`, and asserts on chunk count (and optional substring matches). The hybrid path **embeds the query** via Gemini, so a valid `GEMINI_API_KEY` and a **bootstrapped** database with matching chunks for the slug are required.

**Local:** `pnpm db:setup` (and real ingestion, or the CI fixture below), then `pnpm eval:retrieval`.

**CI:** The workflow job `retrieval-eval` in `.github/workflows/ci.yml` runs only when the repo defines `GEMINI_API_KEY` as a secret. It runs `db-setup`, `pnpm ci:retrieval-fixture` (minimal chunk for `apple-iphone-16-pro`), then `eval:retrieval`’s entrypoint without `.env.local`. See [ADR 0010](../adr/0010-pwa-seo-analytics-compare.md).

## Scorecard and other evals

See [ADR 0005](../adr/0005-e2e-and-evaluation.md) for the scorecard and broader evaluation posture.

# Evaluation

## Hybrid retrieval — `eval:retrieval`

Script: `scripts/eval-retrieval.ts`  
Fixtures: `fixtures/eval/retrieval-fixtures.json`

Runs hybrid search (vector + FTS + RRF, etc.) for each fixture’s `phoneSlug` and `query`, and asserts on chunk count (and optional substring matches). The hybrid path **embeds the query** via Gemini, so a valid `GEMINI_API_KEY` and a **bootstrapped** database with matching chunks for the slug are required.

**Local:** `pnpm db:setup` (and real ingestion, or the CI fixture below), then `pnpm eval:retrieval`.

**CI:** The workflow job `retrieval-eval` in `.github/workflows/ci.yml` runs only when the repo defines `GEMINI_API_KEY` as a secret. It runs `db-setup`, `pnpm ci:retrieval-fixture` (minimal chunk for `apple-iphone-16-pro`), then `eval:retrieval`’s entrypoint without `.env.local`. See [ADR 0010](../adr/0010-pwa-seo-analytics-compare.md).

## Scorecard and other evals

See [ADR 0005](../adr/0005-e2e-and-evaluation.md) for the scorecard and broader evaluation posture.

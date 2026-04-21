# Evaluation — retrieval & Q&A

**Status:** Phase 3+ (2026-04-21)  
**ADR:** [0005 — E2E and evaluation tiers](../adr/0005-e2e-and-evaluation.md)

This folder holds **fixtures** for offline-ish evaluation. It does **not**
replace product analytics — it gives developers repeatable checks after changing
retrieval, ingestion, or prompts.

## Commands

| Command                | What it checks                                     | Typical use              |
| ---------------------- | -------------------------------------------------- | ------------------------ |
| `pnpm test`            | Pure unit tests (RRF, MMR, coverage, citations, …) | Every PR / CI            |
| `pnpm retrieval:smoke` | One hybrid search on a phone that has chunks       | After `db-setup`, ingest |
| `pnpm eval:retrieval`  | All rows in `eval/retrieval-fixtures.json`         | After corpus updates     |
| `pnpm e2e`             | Playwright: SSR phone page + mocked `/api/ask` UI  | CI + local               |

## `eval/retrieval-fixtures.json`

Each fixture is:

- `phoneSlug` — must exist in `phones` after seed / ingest.
- `query` — natural language passed to `HybridRetriever.search`.
- `expect.minChunks` — minimum number of chunks returned (use `1` for a soft
  smoke; raise when you have a stable corpus).
- `expect.anyChunkTextIncludes` — optional list of substrings; **each** must
  appear in **some** retrieved chunk’s `text` (case-insensitive). Leave `[]`
  when you only care that retrieval is non-empty.

**Note:** If the phone has **zero chunks**, evaluation fails by design — run
ingestion first.

## Tier 3 (future): generative citation eval

When we add a scripted harness that calls `runPhoneQna` with live Gemini:

- Keep it **out of default CI** unless sponsored API budget exists.
- Record pass/fail rules in this README and in the Open Questions table
  (`Q4`) of `RECSY_V2_PROJECT_CONTEXT.md`.
- Prefer **snapshotting chunk ids** from a golden retrieval run rather than
  free-form BLEU on answer text.

## Related docs

- Hybrid retrieval design: [ADR 0004](../adr/0004-hybrid-retrieval.md)
- Operator tuning: [retrieval README](../retrieval/README.md)

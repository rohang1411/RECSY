# ADR 0006 — Aspect scorecard (Phase 4 MVP)

Date: 2026-04-21  
Status: Accepted  
Supersedes: none. Narrows §12 in `RECSY_V2_PROJECT_CONTEXT.md` until calibration
and multi-query retrieval land.

## Context

Phase 4 needs a **shippable** scorecard that writes `aspects` rows from real
review chunks without exploding embedding cost or pretending we have peer-group
calibration we have not implemented.

## Decision

### 1. One hybrid retrieval per aspect, one combined query

For each phone × aspect, we build a **single** natural-language query from
`aspect_definitions.query_prompts` (joined with newlines, UTF-8 byte cap in
`src/services/scorecard/constants.ts`). Hybrid search runs **once** per aspect
(one embed + vector + FTS + RRF + MMR + coverage), reusing `HybridRetriever`
with scorecard-specific `k` and a softer `minDistinctSources` than chat Q&A.

**Deferred:** fusing multiple specialised queries per aspect (e.g. separate
embeds for “battery life” vs “charging speed”) — documented as follow-up.

### 2. Structured LLM extraction + grounded evidence

Gemini structured output validates against `aspectScorecardExtractionSchema`
(`overallScore` 0–10, `confidence` 0–1, `summary`, `supporting` / `dissenting`
with UUID `chunkId` + excerpt). The agent:

1. Validates every cited `chunkId` ⊆ retrieved chunks.
2. On failure, **one retry** with invalid ids called out in the user message.
3. If ids are still invalid, **strips** bad evidence and persists the rest.

### 3. No z-score / price-bracket calibration in MVP

`aspects.score` and `aspects.rawScore` are the same formatted value from
`overallScore`. **Peer normalisation** and `aspect_definitions.metadata` driven
brackets are explicitly out of scope until we have stable corpora and product
semantics.

### 4. Recency affects confidence only

`recencyConfidenceBoost` adds a small additive bump to `confidence` when cited
chunks skew recent (90-day window). It does **not** rescale the 0–10 score.

### 5. Empty corpus → neutral row

If retrieval returns zero chunks, we upsert a **neutral** aspect row (score 5,
low confidence, fixed “not enough reviews” summary) so downstream joins and UI
invariants stay simple.

### 6. Operations

- **CLI:** `pnpm scorecard:run --phone <slug>` or `--all` (`scripts/scorecard-run.ts`).
- **`pg_cron` / weekly automation:** documentation only for now; same pattern as
  ingestion cron once ops wants it.

### 7. UI

`/p/[slug]` renders `ScorecardSection` when at least one `aspects` row exists
for the phone; otherwise the section is omitted.

## Consequences

- Cost is bounded at **~7 embed + 7 structured calls per phone** per full run
  (seven aspects), plus DB writes.
- Scores are **absolute**, not bracket-relative — copy and recommender weighting
  must not assume calibration until a future ADR removes this constraint.
- Evidence quality depends on ingestion depth; thin corpora surface as low
  confidence or neutral rows, not hallucinated citations.

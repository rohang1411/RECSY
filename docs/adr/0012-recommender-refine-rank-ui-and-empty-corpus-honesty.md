# ADR 0012 — Recommender refine-over-prior-picks, explicit rank UI, and empty-corpus honesty

## Status

Accepted (2026-04-24)

## Context

Three issues surfaced in real use that pointed at deeper, latent problems in the system — not purely polish:

1. **“Which of these is best for performance?” returned the same list.**
   `POST /api/recommend` loaded the previous turn’s `extractedRequirements` and asked the LLM to merge the new message in, then re-ran the full-catalog ranker. On a short follow-up like “which one should I prefer for the best performance out of these 3,” the LLM merged `performance` into `priorities`, the ranker saw the whole catalog, and the top-K + brand-diversity cap frequently produced the **same slugs**. Users correctly read that as “the recommender is not smart enough.”
2. **No explicit rank in the UI, and the UI always implied three picks.**
   The matcher returned ≤ 3 picks (it never hallucinates), but the client rendered them as an unordered list, with only a numeric `score` on the right. A user with two matches saw two cards but no signal that “2 is all we had.”
3. **Phone Q&A gave the same “no info in the excerpts” refusal for every question, including generic ones like “how is the camera?”**
   Root cause was **not** the prompt: `pnpm db:setup` seeds only `phones` + `aspect_definitions`, not `sources` / `chunks`. Without a subsequent `pnpm ingest --phone <slug>`, retrieval legitimately returned 0 chunks, `runPhoneQna` still called the LLM with an empty `SOURCE EXCERPTS` block, and the model dutifully reported the absence. **The UX treated an ops-state problem (no corpus) as a knowledge-state problem (model can’t find it).**

A fourth regression was fixed at the same time: the **“Show retrieval pipeline & sources” button never rendered** despite the server emitting `retrievalTrace` on the NDJSON `done` line. The client’s `setMeta` dropped the field while forwarding `retrievalMs` and `model`.

## Decision

### 1. Recommender: refine-over-prior-picks path

- New file `src/services/recommender/refine-intent.ts` exposes `detectRefineIntent(message)`, a conservative heuristic that returns `refine: true` when a short message contains refine-style language (“which of these,” “of the three,” “rank them,” “between the top two,” …) **and** does **not** contain new-query hints (“under $500,” “instead show me…,” “forget these,” …). It is deliberately biased toward false negatives: a missed refine just runs the existing full-catalog path, which is no worse than today. A false positive could surprise the user.
- New session helper `getLatestRecommendPickIds(db, sessionId)` returns the `candidatePhoneIds` of the most recent `recommend` turn for this session.
- `runRecommendationPipeline` now, after requirement extraction and confidence gating:
  - runs `detectRefineIntent` on the raw user message;
  - if refine is detected **and** prior picks exist, **filters the full catalog to those ids** before calling `rankCandidates`;
  - if that narrowed ranking returns any picks, sets `refined: true` on the result and the user sees a re-ranked subset;
  - otherwise falls back to the normal full-catalog path (e.g. a filter like `budget.max` changed enough to exclude all prior picks).
- `RecommendPipelineResult.results` grows a `refined: boolean` field; `POST /api/recommend` surfaces it on the JSON response; the client renders “Re-ranked your earlier picks” next to the picks header when true.

No schema migration: the existing `recommendationTurns.candidatePhoneIds` column already stores pick ids for every `recommend` turn (persisted at write time in the API route). `recommendationIntentEnum` is **not** extended with a `refine` variant; a refine turn is still an `intent: 'recommend'` row with the re-ranked picks recorded, which keeps the enum schema backward-compatible and makes the turn indistinguishable from a fresh recommend turn for the purposes of downstream analytics.

### 2. Explicit rank labels and honest count in the UI

`src/app/recommend/recommend-client.tsx`:

- A new `rankLabel(index)` helper maps 0 → `Top pick`, 1 → `Runner-up`, 2 → `3rd`, N>2 → `#N+1`.
- Each pick card now leads with a rank badge (solid `primary` for index 0, muted outline for others) **before** the brand pill.
- A header line above the list says, e.g., `Showing 2 picks, ranked` (not “top 2 of 3 we couldn’t find”) and appends `· re-ranked from your earlier picks` when `refined` is true.
- The chat intro text is rewritten so “one match,” “two picks,” or “top 3” is **stated**: “Here are the top 2 picks, ranked for what you said matters.”

Nothing in the matcher or API response padded to three. The matcher already returned up to three via `pickDiverseTop`; the UI now stops lying about it.

### 3. Empty-corpus honesty in `/api/ask`

`src/services/chat/answer.ts`:

- If `retrieval.chunks.length === 0` after hybrid retrieval, `runPhoneQna` **short-circuits** — it does not call the LLM — and returns a deterministic message that names the problem (“I have no review sources ingested for this phone yet …”), a developer hint (`pnpm ingest --phone <slug>`), and routes the user to **Recommend** / **Compare** for catalog-wide questions.
- The short-circuit returns `usage: { tokensIn: 0, tokensOut: 0 }` and a sentinel `model: 'no-context@v1'` (exported as `NO_CONTEXT_MODEL`). `persistChatQuery` still records the turn, so ops can pull a SQL report of “phones that get asked about but have no corpus.”
- `RetrievalResult.debug` is preserved and still fed through `buildAskRetrievalTrace`, so the client’s “Show retrieval pipeline & sources” disclosure renders a useful trace (all stages with `count: 0`).

This is a product decision: a cheap, deterministic, honest message is better than a token-burning refusal that looks identical to a model failure. Once ingestion lands for a phone, the normal retrieval + answer path takes over automatically — no code change required.

### 4. Wire `retrievalTrace` into the phone-chat client

`src/app/p/[slug]/phone-chat.tsx`:

- `StreamEvent['done']` gains `retrievalTrace?: AskRetrievalTrace`.
- The NDJSON `done` handler forwards `evt.retrievalTrace` into the `meta` React state. The existing `<details>` disclosure was gated on `meta?.retrievalTrace` and now actually renders once data arrives.

This closes the regression introduced in ADR 0011 where the field was produced on the server and lost on the client.

## Consequences

- **Follow-ups now re-rank prior picks.** A session with `Top pick: A, Runner-up: B, 3rd: C` asked “rank for performance” deterministically returns `A, B, C` re-ordered by the performance-weighted aspect score, not a fresh full-catalog scan. Sessions that legitimately need new picks (user changes budget, rules out a brand, asks for “something different”) continue to use the full catalog path — the new-query hints in `refine-intent.ts` protect against over-capture.
- **Users see honest counts and a clear top pick.** “Showing 1 match, ranked” is more truthful than “top 1 of 3.”
- **Empty-corpus questions are transparent.** Developers running locally without ingestion get told exactly what to do instead of debugging a “retrieval is broken” phantom. Free-tier users on a public deployment without any ingested sources get a deterministic, budget-free answer.
- **No DB migrations.** No new enums, no new tables, no new columns. All behavior is derived from existing session rows and retrieval state.
- **New tests**:
  - `src/services/recommender/refine-intent.test.ts` — positive + negative + long-message + new-query-hint coverage.
  - `src/services/chat/answer.test.ts` — zero-chunk short-circuit asserts no LLM call and the sentinel `model` value.
- **Known follow-ups** (not in this ADR):
  - A ranked-list explainability panel (why _A_ beat _B_ for the current priorities).
  - A dev-only seed-corpus target so local `/api/ask` works without running the full ingestion pipeline (a richer variant of `scripts/seed-retrieval-eval-fixture.ts`).

## Related

- [ADR 0004 — hybrid retrieval](0004-hybrid-retrieval.md) — phone-scoped retrieval.
- [ADR 0007 — recommender MVP](0007-recommender-mvp.md) — extract → rank → diversify baseline.
- [ADR 0011 — Phone Q&A scope, images, landing, ask trace](0011-phone-qa-scope-images-home-ask-trace.md) — ask `retrievalTrace` contract whose client wiring is completed here.

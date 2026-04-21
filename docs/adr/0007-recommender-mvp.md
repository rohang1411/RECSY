# ADR 0007 — Conversational recommender (Phase 5 MVP)

Date: 2026-04-21  
Status: Accepted  
Supersedes: none. Narrows §11 in `RECSY_V2_PROJECT_CONTEXT.md` for the first
shippable intake → picks flow.

## Context

Phase 5 needs a **working** landing funnel: multi-turn preference capture,
persistence, and top phone suggestions grounded in the same `phones` + `aspects`
data the scorecard maintains. Full §11 (semantic `spec_embedding` retrieval,
Gemini Pro tie-break, rich soft-filter NLP) is easy to under-ship or over-build.

## Decision

### 1. Stage A — structured extraction (Flash)

- Single **Zod** schema (`userRequirementsSchema`) aligned with §11: budget,
  weighted priorities, must-haves, deal-breakers, use cases, form factor,
  brand preferences, confidence, optional clarifying question.
- **Gemini Flash** `structured()` per user message. Priorities are **renormalised
  in code** so weights always sum to 1 after merge.
- **Multi-turn merge:** the API loads the latest turn’s `extracted_requirements`
  for the cookie-bound session and passes it back to the model as
  `PREVIOUS_STATE_JSON`.
- **`confidence < RECOMMENDER_CLARIFY_THRESHOLD` (0.6):** respond with
  `kind: clarify` and a question; persist a `recommendation_turns` row with
  intent `clarify`. No candidate ranking this turn.

### 2. Stage B — candidates + optional `spec_embedding` blend

- **Hard filters** on parsed `PhoneSpec` + `msrp_usd`: budget min/max, optional
  foldable, screen-size range, max weight, **disliked brands** excluded.
- **Deal-breakers:** substring match over a small haystack (brand, model,
  tagline, chipset, OS, highlights) — disqualify if hit.
- **Must-haves:** soft multiplier on the composite score from keyword overlap
  (not hard exclusion — avoids empty sets from overly literal matches).
- **Aspect join:** weighted sum of `aspects.score` using user priorities, with
  **missing priorities filled from `aspect_definitions.default_weight`** (latest
  version row per axis, same helper as the scorecard).
- **Semantic signal (additive):** when **any** active phone has a non-null
  `spec_embedding`, the pipeline embeds `buildRecommenderQueryText(requirements)`
  once and adds a bounded bonus from **cosine similarity** vs each phone’s
  `spec_embedding` (`RECOMMEND_SPEC_SIMANTIC_BUMP` in code). If **no** rows have
  embeddings, the extra Gemini embed is skipped (no-op on rank order).
- **Backfill:** `pnpm spec-embed:backfill` writes **`buildSpecDocumentForEmbedding`**
  text to `gemini-embedding-001` and updates `phones.spec_embedding` (default:
  only rows where the column is null; `--force` re-embeds all active phones).
  Not part of `db:setup` — operators run after seed / when specs change.
- **Diversity:** at most **two** phones per **brand** in the top **three** picks
  (same intent as §11).

### 3. Relaxation ladder (zero candidates)

1. Strict filters.
2. Widen **budget max** once (`RECOMMEND_BUDGET_RELAX_FACTOR`, 1.2×).
3. If the user asked for **foldable only**, drop that constraint (keep widened
   budget if it applied).
4. **Fallback:** all active phones that still pass deal-breakers, ranked by the
   same score — surfaced in the API as `relaxed` string codes for honest UI
   copy.

### 4. Stage C — ranking / tie-break

- **Deterministic** composite score only — **no Gemini Pro tie-break** in MVP
  (cost + latency). Deferred with explicit ADR revision when we have offline
  eval thresholds.

### 5. Sessions, persistence, limits

- **HttpOnly cookie** `recsy_rec_session` → `recommendation_sessions.session_cookie`
  (14-day `maxAge`, `secure` in production via `env.NODE_ENV`).
- Each POST writes **`recommendation_turns`** (latency, intent, requirements
  JSON, candidates + picks on `recommend` intent).
- **Separate rate-limit key** from `/api/ask`: `recommend:v1:` prefix,
  `RECOMMEND_RATE_LIMIT_*` constants.

### 6. UI

- **`/recommend`** — chat-style intake + result cards linking to `/p/[slug]`.
- **`/browse`** — simple active-phone list (fixes the landing CTA that already
  pointed here).

## Consequences

- Recommendations are **only as good as aspect scorecard coverage** — phones
  without scorecard rows still rank (neutral 5s on missing axes).
- **Must-haves / deal-breakers** are heuristic — users may need to rephrase;
  clarify flow mitigates low-confidence states.
- **Pro tie-break** remains a follow-up; **spec_embedding** backfill is operator-
  driven but no longer an unimplemented gap in code.

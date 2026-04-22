# Recommender (Phase 5 MVP)

End-to-end: **structured preference extraction** → **deterministic candidate
ranking** → **three diverse picks**. Full pipeline semantics: §11 in
`RECSY_V2_PROJECT_CONTEXT.md`. Scope boundaries: [ADR 0007](../adr/0007-recommender-mvp.md).

## User-facing routes

| Route        | Purpose                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `/recommend` | Multi-turn chat intake + pick cards                                                            |
| `/browse`    | Active phones + URL filters → `/p/[slug]` — see [`docs/browse/README.md`](../browse/README.md) |

## API

`POST /api/recommend`

- **Body:** `{ "message": string }` (byte cap: `MAX_RECOMMENDER_MESSAGE_BYTES`).
- **Cookie:** sets `recsy_rec_session` on first visit; binds
  `recommendation_sessions` / `recommendation_turns`.
- **Rate limit:** hashed client IP, separate bucket from `/api/ask`.

**Responses**

- `{ "kind": "clarify", "clarifyingQuestion": string }`
- `{ "kind": "results", "picks": [...], "relaxed": string[], "refined": boolean }`

`refined: true` signals that this turn re-ranked the previous turn's picks
instead of scanning the full catalog — see **Refine over prior picks** below
and [ADR 0012](../adr/0012-recommender-refine-rank-ui-and-empty-corpus-honesty.md).
Pick count in `picks` is **honest**: up to 3, but fewer if the ranker (or the
narrowed refine set) produced fewer matches. The UI never pads.

### Refine over prior picks

Short follow-ups like "which of these is best for performance" or "rank them
for battery" are detected by `detectRefineIntent` in
`src/services/recommender/refine-intent.ts` and re-rank only the phones that
came back on the most recent `recommend` turn in this session. This keeps the
pipeline stateful enough for realistic conversational refinement without a
dedicated chat intent or schema change.

Rules of thumb:

- **Refine is detected** when the message is short and uses phrases like
  "of these", "between the top two", "rank them", "which of the three".
- **New-query hints override refine** — anything like "under $500",
  "instead", "forget those", "show me something different", or "start over"
  skips the refine path and runs the full catalog ranker.
- **If the refine set is empty after filters** (e.g. a newly tightened budget
  excludes all prior picks), the pipeline falls back to the full-catalog path
  and clears `refined` so users still get useful picks.

### Stage A: structured `UserRequirements` (Gemini + Zod)

`generateObject` validates every extraction against
`userRequirementsSchema` in `src/services/recommender/requirements-schema.ts`. If
validation fails, the `GeminiProvider.structured` path retries **once** with a
system nudge; a second failure surfaces as **HTTP 502** with
`code: LLM_SCHEMA_VIOLATION` and message `Gemini structured output failed validation
twice`.

**Google Gemini + `responseSchema`:** the Zod object must not use shapes that
map to a JSON-Schema `items` edge case Gemini’s protobuf API rejects (we avoid
2-tuple / fixed array for `form_factor` screen size; the model emits
`screen_size_min_in` / `screen_size_max_in` instead, then we map to
`screen_size_range_in` for the ranker). The retry nudge is sent as a **`user`**
turn, not `system` — Gemini only allows `system` as the first message.

**Operational hardening (post–Phase 5):** the schema is intentionally **lenient**
on common model quirks, then `normalizeUserRequirements` applies stable app
semantics. Examples: aspect names are normalised to lowercase enum values;
`priorities[].weight` accepts 0–100-style relative values before renormalising to
0–1; `budget_usd` accepts a bare number, currency-like strings, or `min`/`max`
with `$`; `form_factor` / `brand_preference` may be `null` from the model;
`confidence` is coerced from strings and optional percent-style integers. See
`requirements-schema.test.ts` for cases.

If a new model version keeps failing validation, inspect `cause` on the error (or
log the first Zod message before retry) to extend the same pattern — do not
weaken `match.ts` invariants with unvalidated `any` data.

### How to see why validation failed (local dev)

1. **Terminal** — Run `pnpm dev` and keep that window visible. On failure the
   API logs `POST /api/recommend failed` with `code`, `context` (includes
   `firstAttempt` / `secondAttempt` for Zod issues), and `detail` (full
   `Error`+`cause` chain as text).
2. **Trace id** — Response headers include `X-Trace-Id`; the same `traceId` is
   in the log line (pino `traceId` field) so you can match request ↔ log.
3. **Browser (development only)** — The JSON error body for
   `LLM_SCHEMA_VIOLATION` may include a `debug` object with the same
   `context` and `causeChain` (only when `NODE_ENV=development`, never in
   production). Inspect **Network** → `recommend` → **Response** for that
   payload.
4. **Log level** — Default `LOG_LEVEL=info` is enough for these `warn` lines;
   you do not need `debug` to see the schema details above.

## `spec_embedding` (optional but recommended)

Seeds do **not** populate `phones.spec_embedding`. After `db:setup` / seed:

```bash
pnpm spec-embed:backfill
```

- **Default:** only phones with `spec_embedding IS NULL` (active status).
- **`--force`:** re-embed every active phone (e.g. after changing
  `buildSpecDocumentForEmbedding`).

When at least one phone has an embedding, `/api/recommend` embeds the user
preference text once and adds a **small additive** score from cosine similarity
(see `RECOMMEND_SPEC_SEMANTIC_BUMP` in `src/services/recommender/constants.ts`).

## Code layout

| Path                                               | Role                                       |
| -------------------------------------------------- | ------------------------------------------ |
| `src/services/recommender/requirements-schema.ts`  | Zod + normalisation                        |
| `src/services/recommender/extract-requirements.ts` | Flash structured extract                   |
| `src/services/recommender/spec-embedding-text.ts`  | Doc string for spec + query embed          |
| `src/services/recommender/vector-utils.ts`         | Vector parse + cosine                      |
| `src/services/recommender/catalog.ts`              | Load phones + aspects + `spec_embedding`   |
| `src/services/recommender/match.ts`                | Filters, scoring, diversity, semantic bump |
| `src/services/recommender/run-recommendation.ts`   | Orchestration                              |
| `src/services/recommender/session.ts`              | Session + latest requirements              |
| `src/app/api/recommend/route.ts`                   | HTTP, persistence, rate limit              |
| `scripts/backfill-spec-embeddings.ts`              | CLI: `pnpm spec-embed:backfill`            |

## Follow-ups

- **Gemini Pro** (or Flash) structured tie-break when top scores are close.
- Richer NLP for must-haves / deal-breakers; regional availability filters.

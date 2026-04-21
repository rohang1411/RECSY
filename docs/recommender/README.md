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
- `{ "kind": "results", "picks": [...], "relaxed": string[] }`

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

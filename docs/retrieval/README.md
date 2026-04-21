# Retrieval — operator & developer guide

**Status:** Phase 3, in progress (2026-04-21).
**Code:** [`src/services/retrieval/`](../../src/services/retrieval/)
**Rationale:** [ADR 0004 — Hybrid retrieval](../adr/0004-hybrid-retrieval.md)

This is the guide for anyone touching the retrieval layer: how to call
it, how to tune it, how to debug a bad result, and how to extend it.

---

## 1. What retrieval does

Given `(phoneId, query)` it returns up to 8 chunks of ingested text,
each with a resolved source (URL, title, type, optional YouTube
timestamp). Those chunks are what the chat generator uses to answer
Q&A, what the aspect agent uses to extract signals, and what the
recommender will use for spec-grounded tie-breakers.

Retrieval is **phone-scoped**. There is no cross-phone search. We
denormalised `chunks.phone_id` specifically to make this query cheap.

## 2. How to call it

### From a route handler

```ts
import { createHybridRetriever } from '@/services/retrieval';

// Process-wide singleton is fine — `getPostgres()` reuses the same pool as `getDb()`.
const retriever = createHybridRetriever();

// Per request:
const result = await retriever.search({ phoneId, query, options: { rerank: 'off' } });
for (const chunk of result.chunks) {
  // render citation from chunk.source + chunk.startTs / chunk.anchor
}
```

For custom wiring (tests / one-offs), import `getPostgres` from
`@/services/db/client` and pass it to `VectorSearch` / `FtsSearch`; see
`createHybridRetriever` in `src/services/retrieval/factory.ts`.

### From a CLI / smoke test

Run `pnpm retrieval:smoke` (`scripts/retrieval-smoke.ts`) against the live
DB (`DATABASE_URL` in `.env.local`).

## 3. Pipeline at a glance

```
query ──> LLM.embed ──▶ vector search (cosine, HNSW, phone-scoped)
                   \
                    ▶ FTS search   (tsvector + trigram fallback)
                          │
                          ▼
                   RRF fusion (k=60)
                          │
                          ▼
                   MMR rerank (λ=0.6, top ≤ 2k)
                          │
                          ▼
                   source-coverage clamp (≥3 distinct sources if possible)
                          │
                          ▼
                   final top-k (default 8)
```

Each stage logs `{ count, ms }` via the `retriever=hybrid` child logger.
Enable `LOG_LEVEL=debug` to also see per-retriever rows and RRF
contribution maps.

## 4. Tuning knobs (`RetrievalOptions`)

| Option               | Default | When to change it                                                                                                                                             |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kPerRetriever`      | 30      | Larger when the corpus is big or MMR is being too aggressive.                                                                                                 |
| `targetResults`      | 8       | Smaller for comparison Q&A where the context budget is tight; larger for aspect-agent retrieval.                                                              |
| `rrfK`               | 60      | Literature default; rarely worth changing until you have eval data.                                                                                           |
| `mmrLambda`          | 0.6     | Lower (0.3–0.5) if answers cite near-duplicates; higher (0.8) if MMR is dropping correct-but-similar chunks.                                                  |
| `minDistinctSources` | 3       | Lower to 1 for single-source testing; higher when reviewing consensus claims.                                                                                 |
| `rerank`             | `'off'` | `'llm'` runs structured Flash rerank after MMR (`src/services/retrieval/llm-rerank.ts`). `/api/ask` enables it via `RETRIEVAL_LLM_RERANK=true` (see `@/env`). |
| `llmRerankPoolSize`  | 12      | Max MMR-ranked excerpts sent to the reranker.                                                                                                                 |

Quality checks: [`docs/eval/README.md`](../eval/README.md) (`pnpm eval:retrieval`).

Per-source cap: defaulted to `ceil(k / minDistinctSources)` (so
`k=8, min=3 → max 3/source`). Pass `CoverageOptions.maxPerSource`
explicitly for a hard cap.

## 5. Observability

Every call logs at `info`:

```
{
  "level": "info",
  "retriever": "hybrid",
  "phoneId": "...",
  "finalCount": 8,
  "sourceCount": 4,
  "relaxed": false,
  "totalMs": 34
}
```

Plus these fields are available at `debug`:

- `vector.count`, `vector.ms`
- `fts.count`, `fts.ms` (watch for 0s — means tsvector missed and
  trigram fallback fired; often a query-quality issue)
- `rrf.count`, `mmr.count`
- `coverage.sourceCount`, `coverage.relaxed`
- `llmRerank.ms`, `llmRerank.applied`, `llmRerank.fallback` (only when
  `rerank: 'llm'` was requested)

If `relaxed: true` in production, the phone only has 1–2 distinct
sources — an ingestion gap, not a retrieval bug. Grow the corpus.

## 6. Debugging playbook

### "Answer cites the wrong chunk"

1. Rerun the query with `LOG_LEVEL=debug` and read the per-stage counts.
2. Check `vector.count` — if 0 or tiny, the embedding call likely
   failed (look for a preceding `warn` from `GeminiProvider.embed`).
3. Check `fts.count` — if 0 and `tsvector empty; falling back to
trigram` appears, your query is too short for the English stemmer.
4. Query the DB directly:
   ```sql
   SELECT id, substr(text, 1, 80), ts_rank_cd(text_tsv, websearch_to_tsquery('english', $query)) AS rank
   FROM chunks WHERE phone_id = $phone
     AND text_tsv @@ websearch_to_tsquery('english', $query)
   ORDER BY rank DESC LIMIT 20;
   ```
5. If the right chunk isn't in the top-20 of either retriever, it's
   an indexing/ingestion issue — go look at the source.

### "MMR dropped chunks I wanted"

- Bump `mmrLambda` towards 1.0 — the default (0.6) favours diversity.
- Check that candidates carry embeddings (`withEmbeddings: true` on
  the `VectorSearch` instance). FTS-only chunks are treated as
  duplicates by default and sink to the back, which is correct for
  our pipeline but surprising if you call MMR directly on FTS output.

### "I get `relaxed: true` everywhere"

- The phone has <3 ingested sources. Run
  `SELECT count(DISTINCT id) FROM sources WHERE phone_id = $p AND status = 'active'`.
- Fix: ingest more. YouTube will probably be throttled (see ingest
  docs); try article URLs and Reddit threads.

## 7. Extending the pipeline

### Add a third retriever

Implement `Retriever` (see `vector.ts` / `fts.ts` for shape), wire it
into `HybridRetriever` as a third dependency, and include its output
in the `reciprocalRankFusion(...)` call. One line of config change per
callsite.

### Enable LLM rerank

Plumb through `options.rerank === 'llm'` in `retriever.ts` after the
MMR step. Take the top 12 fused chunks, prompt Gemini Flash for a
structured rank (`Array<chunkId>`), then reorder. This is queued
for the `/api/ask` wiring, not general retrieval.

### Add HyDE

Requires one extra Gemini Flash call per user query to generate a
hypothetical answer, then embed both the question and the answer and
average (or concat). Keep it behind `options.hyde = 'on'` — it
doubles the embedding cost.

## 8. Tests

- `rrf.test.ts`, `mmr.test.ts`, `coverage.test.ts` — pure-function
  maths, fully unit-tested (no DB).
- `vector.ts` / `fts.ts` / `retriever.ts` — exercised via
  `pnpm retrieval:smoke` (`scripts/retrieval-smoke.ts`).

Run just the retrieval suite:

```bash
pnpm test -- --run src/services/retrieval
```

## 9. Known limitations

- **Query embedding cost.** Every call costs one Gemini embedding
  request. `LlmProvider.embed` is **not** cached (complexity vs
  savings) — we'll revisit when chat volume grows.
- **English-only tsvector config.** Non-English queries will stem
  poorly. Multi-language is Phase 8+.
- **Single-phone retrieval only.** Cross-phone comparison queries
  (`"pixel 9 vs iphone 15 camera"`) are handled at a higher layer by
  running two phone-scoped retrievals and merging — see the upcoming
  compare view.

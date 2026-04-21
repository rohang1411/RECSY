# ADR 0004 — Hybrid retrieval (vector + FTS + RRF + MMR)

Date: 2026-04-21
Status: Accepted
Supersedes: none. Refines §10 of `RECSY_V2_PROJECT_CONTEXT.md`.

## Context

Phase 3 turns our ingested chunks into answers. The retrieval layer
takes `(phoneSlug, query, k)` and must return a ranked set of chunks
that:

1. Maximises recall — every answer should be reachable from something
   in the index; if a relevant passage is there, we want it in the
   candidate set.
2. Maximises precision under a fixed context budget — we can't stuff
   the LLM with 50 chunks; we have ~8 slots.
3. Prefers diverse sources — a single over-enthusiastic reviewer
   shouldn't dominate; conflicting opinions are part of our value
   proposition.
4. Stays cheap — every user query budgets ≤1 embedding call, ≤1
   generation call, ≤1 optional rerank call.

We have ~hundreds to thousands of chunks per phone, stored in
`chunks.embedding vector(768)` (HNSW cosine) and `chunks.text`. No
external search infra is available on zero budget.

## Decision

Layer three techniques and compose them behind a single
`HybridRetriever.search()` entry point:

```
          ┌──────────────────────┐          ┌──────────────────────┐
query ─▶  │ vector search (K=30) │          │  FTS search (K=30)   │
          │ pgvector cosine      │          │  websearch_to_tsquery│
          │ HNSW, phone-scoped   │          │  + pg_trgm fallback  │
          └──────────┬───────────┘          └───────────┬──────────┘
                     │                                  │
                     └──────────────┬───────────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │ Reciprocal Rank Fusion (RRF)│  rank-based merge;
                     │        score = Σ 1/(k+rᵢ)   │  no cross-calibration
                     └──────────────┬──────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │ MMR (λ=0.6)                 │  relevance ↔ diversity
                     │ cosine on stored embeddings │  over the top-K fused set
                     └──────────────┬──────────────┘
                                    ▼
                     ┌─────────────────────────────┐
                     │ Source-coverage clamp       │  ≥3 distinct sources
                     │                             │  in the top 8 when possible
                     └──────────────┬──────────────┘
                                    ▼
                              ranked chunks
                               (with scores)
```

### Parameter defaults

| Knob                   | Default | Notes                                                               |
| ---------------------- | ------- | ------------------------------------------------------------------- |
| `K_VECTOR`             | 30      | HNSW cosine; pulled wider than final output for fusion headroom.    |
| `K_FTS`                | 30      | Same K as vector for symmetric RRF weights.                         |
| `RRF_K`                | 60      | Standard constant (Cormack et al. 2009). Robust across retrievers.  |
| `MMR_LAMBDA`           | 0.6     | Slight lean toward relevance; 0.5–0.7 is the usual productive band. |
| `TARGET_RESULTS`       | 8       | Final chunks handed to the generator.                               |
| `MIN_DISTINCT_SOURCES` | 3       | Soft clamp; relaxed if fewer sources exist for the phone.           |
| `TRIGRAM_FALLBACK_MIN` | 0.20    | `similarity()` threshold for the `pg_trgm` branch.                  |

All knobs surface through `RetrievalOptions` so individual callers
(chat Q&A, aspect agent, future recommender) can tune per use case
without editing the retriever.

### Why each layer

- **Vector search (cosine, pgvector HNSW).** Catches paraphrases and
  semantic near-matches where the user's phrasing doesn't match the
  source's phrasing. Free via our existing `chunks.embedding` column
  and HNSW index (built in Phase 1).

- **FTS (`websearch_to_tsquery` + `pg_trgm` fallback).** Catches
  exact-match phrases, model numbers, and acronyms that embeddings
  smooth over ("A18 Pro", "LTPO", "IP68"). `pg_trgm` already enabled;
  we add a **generated `tsvector` column + GIN index** in Phase 3's
  migration. If a `websearch_to_tsquery` returns zero hits we fall
  back to a trigram similarity query — handles misspellings and short
  tokens gracefully.

- **Reciprocal Rank Fusion.** Rank-based ensemble — no score
  normalisation required across the two retrievers (cosine and
  ts_rank_cd are on different scales and drift over time). Widely
  cited, empirically strong, implementable in 15 lines.

- **MMR.** Without diversity pressure, vector search surfaces
  near-duplicate chunks from the same source (adjacent transcript
  slices, same paragraph split twice). MMR adds a diversity penalty
  based on cosine similarity between candidate and already-selected
  chunks, using the stored `vector(768)` embeddings we already have.

- **Source-coverage clamp.** A product constraint, not a retrieval
  constraint. RECSY's pitch is "consensus across many voices", so we
  enforce ≥3 distinct sources in the final set when the phone has that
  many. If fewer exist (new launch), we relax and log it.

### What we're NOT doing (yet)

- **No learned rerank (cross-encoder).** Gemini Flash rerank is
  cheaper than hosting a cross-encoder and integrates with our
  existing `LlmProvider`. Implemented as `RetrievalOptions.rerank:
'off' | 'llm'` (default `'off'`). `/api/ask` enables it when
  `RETRIEVAL_LLM_RERANK=true` (see ADR 0005 for fail-open semantics).
- **No HyDE.** Sounds seductive, but doubles the embedding cost per
  query. We'll add it behind a feature flag only if recall is
  measurably low on the eval harness.
- **No query decomposition / multi-query.** Same reasoning: wait for
  eval evidence.
- **No external vector DB** (Pinecone, Weaviate, Qdrant). Zero budget;
  pgvector + HNSW is measurably sufficient for our corpus size.

### Citation tagging contract

The chat answerer emits `[c:<chunkId>]` inline tags. A pure post-
processor (`citationValidator.ts`) walks the answer string, resolves
every tag against the retrieved set, and:

1. Drops / rejects answers containing unresolved tags.
2. Returns a structured `Citation[]` with `sourceUrl`, `type`,
   `anchor` (for YouTube `?t=<sec>` deep links), and the exact quote
   span.
3. Always returns citations in stable DOM order so the UI can render
   superscript numbers without reshuffling on every token.

A single retry with a stricter system prompt covers the "LLM made up a
chunk id" failure mode; a second failure surfaces an error to the
user.

## Consequences

### Positive

- Every piece is testable in isolation: RRF and MMR are pure,
  retrievers are DB-only integration tests, composer is a thin
  orchestration unit test with mocks.
- Swapping a retriever later (add BM25, add a third signal) means
  implementing the `Retriever` interface and wiring another K into
  the RRF call — no cascading changes.
- Performance: two index-backed queries + pure CPU work per request.
  HNSW is O(log n) on cosine; FTS GIN is O(1) per matched doc. For
  our corpus this is sub-20 ms DB time.
- Structured logging on every layer (latency per sub-query, counts in
  vs out at each filter) means we can diagnose "why did this chunk
  appear?" after the fact.

### Negative / trade-offs

- RRF is rank-based, so we lose fine-grained score signal between the
  retrievers. Acceptable for MVP; if we ever want learned ensembling
  we'll need to revisit.
- MMR's diversity penalty uses stored embeddings — already embedded
  at ingest time with `taskType: 'RETRIEVAL_DOCUMENT'`. The query
  embedding uses `RETRIEVAL_QUERY`. Slight mismatch in the
  diversity-penalty term (we use doc-doc similarity, not doc-query),
  but this is the standard MMR formulation and works well in
  practice.
- We pin `RRF_K=60`. If our two retrievers ever have very different
  reliability profiles (e.g. FTS precision is much higher than
  vector), the symmetric `K` loses information. Revisit after eval
  harness data exists.

## Implementation layout

```
src/services/retrieval/
├── types.ts          # RetrievalRequest, RetrievalResult, Citation,
│                     # RetrievedChunk, RetrievalOptions
├── vector.ts         # class VectorSearch (cosine, phone-scoped)
├── fts.ts            # class FtsSearch (websearch_to_tsquery + trgm)
├── rrf.ts            # pure: reciprocalRankFusion()
├── mmr.ts            # pure: mmrRerank()
├── coverage.ts       # pure: enforceSourceCoverage()
├── retriever.ts      # class HybridRetriever, composes the above
├── index.ts          # barrel
└── *.test.ts         # unit tests colocated
```

DB migration:

```
drizzle/sql/0001_fts_index.sql
  ALTER TABLE chunks ADD COLUMN text_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
  CREATE INDEX chunks_text_tsv_idx ON chunks USING gin (text_tsv);
  CREATE INDEX chunks_text_trgm_idx ON chunks USING gin (text gin_trgm_ops);
```

Generated columns give us zero app-side maintenance burden — Postgres
keeps the tsvector in sync automatically on insert/update.

## Alternatives considered

- **Vector-only retrieval.** Simpler to build, but empirically weaker
  on exact-match / model-number queries that phone buyers actually
  type. Lost even on our small fixture set in early prototyping.
- **Learned sparse retrievers (SPLADE).** Stronger than BM25 in the
  literature but add an ML model to host. Out of budget.
- **ElasticSearch / OpenSearch.** Overkill, costs money. Postgres FTS
  - pg_trgm covers 90% of the value.
- **Qdrant / Weaviate.** Nice APIs, don't solve a problem we have;
  pgvector handles our scale for free.
- **LLM re-ranking as the primary ranker** (no FTS, no RRF). One LLM
  call per query is affordable, but concentrates risk in a single
  model choice and makes debugging rankings harder ("why is chunk X
  third?" → "because the model said so"). Keeping deterministic
  layers underneath the LLM gives us observability.

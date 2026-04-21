/**
 * Retrieval service — public types.
 *
 * The retrieval layer turns `(phoneSlug, query)` into a ranked list of
 * `RetrievedChunk`s. It is **the** abstraction consumed by:
 *   - `/api/ask` (chat Q&A) — Phase 3
 *   - the aspect scorecard agent — Phase 4
 *   - the future conversational recommender — Phase 5
 *
 * See {@link https://github.com/rohan/recsy/blob/main/docs/adr/0004-hybrid-retrieval.md
 * ADR 0004} for the composition rationale (vector + FTS + RRF + MMR).
 *
 * **Design rules:**
 *   - Nothing here knows about HTTP, Next.js, or React. Retrieval is a pure
 *     service layer — it can be called from a route handler, a CLI script,
 *     or the aspect agent with equal ease.
 *   - Every type is `readonly` at the edges. Callers cannot mutate our
 *     outputs, and we cannot mutate their inputs.
 *   - Sub-retrievers implement {@link Retriever} with a uniform shape so
 *     adding a third signal (BM25, learned sparse, etc.) is a single-file
 *     change plus a new K parameter.
 */

/** A chunk returned by a retriever or a ranker, with scoring metadata. */
export interface RetrievedChunk {
  /** `chunks.id` UUID. */
  readonly chunkId: string;
  /** Denormalised source reference (avoids an extra join at the callsite). */
  readonly sourceId: string;
  /** Chunk text. Short enough to fit in an LLM context window. */
  readonly text: string;
  /**
   * Similarity/relevance score, higher is better.
   *
   * - **Vector retriever:** `1 - cosine_distance` ∈ [0, 2], clamped to [0, 1]
   *   for display.
   * - **FTS retriever:** `ts_rank_cd` ∈ [0, ∞), unbounded.
   * - **RRF:** `Σ 1/(k + rank_i)` ∈ [0, 2/k]`.
   * - **MMR:** relevance - λ * max_sim_to_selected, usually ≈ vector score.
   *
   * Scales are NOT cross-comparable between retrievers — rank matters, not
   * magnitude. RRF exists precisely to side-step this.
   */
  readonly score: number;
  /** Source metadata we join in so callers can render citations without N+1. */
  readonly source: RetrievedSource;
  /**
   * Embedding pulled from `chunks.embedding`. Present only when a downstream
   * step (like MMR) explicitly requests it via `RetrievalOptions.withEmbeddings`.
   */
  readonly embedding?: readonly number[];
  /** YouTube seconds offset for deep-linking. */
  readonly startTs?: number | null;
  /** Anchor fragment appended to the source URL for deep-linking. */
  readonly anchor?: string | null;
}

/** Flattened source fields needed to render a citation. */
export interface RetrievedSource {
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly type: 'youtube' | 'reddit' | 'article';
  readonly author: string | null;
  readonly channel: string | null;
  readonly publishedAt: Date | null;
}

/** Input to a single retriever (vector, FTS, etc.). */
export interface RetrievalRequest {
  /** `phones.id` UUID — retrieval is always phone-scoped. */
  readonly phoneId: string;
  /** Natural-language user query. */
  readonly query: string;
  /** Max candidates to return. */
  readonly k: number;
  /**
   * For vector retrieval, the caller supplies the pre-computed query
   * embedding to avoid double-paying for the same Gemini call.
   */
  readonly queryEmbedding?: readonly number[];
}

/**
 * Uniform retriever contract. Each implementation focuses on one signal.
 * Composition happens in {@link HybridRetriever}.
 */
export interface Retriever {
  /** Human-readable name for logs / tracing. */
  readonly name: string;
  search(request: RetrievalRequest): Promise<readonly RetrievedChunk[]>;
}

/** Options for the top-level {@link HybridRetriever.search}. */
export interface RetrievalOptions {
  /** Pre-retrieval per-signal K. Default 30. */
  readonly kPerRetriever?: number;
  /** Target size of the final ranked list handed to the generator. Default 8. */
  readonly targetResults?: number;
  /**
   * RRF constant. Default 60 (Cormack et al. 2009). Larger = ranks at the
   * tail matter less.
   */
  readonly rrfK?: number;
  /** MMR λ ∈ [0, 1]. Default 0.6. 1.0 = pure relevance, 0.0 = pure diversity. */
  readonly mmrLambda?: number;
  /**
   * Minimum distinct `sources.id` values in the final set when enough exist.
   * Default 3. A soft clamp — if the phone only has one source, we return
   * whatever we found.
   */
  readonly minDistinctSources?: number;
  /**
   * Whether to include an LLM rerank step after MMR. Default 'off' for MVP;
   * `/api/ask` will flip to 'llm' once the basic flow is validated.
   */
  readonly rerank?: 'off' | 'llm';
  /**
   * How many MMR-ranked excerpts the LLM reranker may see (cap). Default 12.
   * Ignored when {@link rerank} is `'off'`.
   */
  readonly llmRerankPoolSize?: number;
}

/** Resolved defaults. Private to the retrieval module; exported for tests. */
export const DEFAULT_OPTIONS = {
  kPerRetriever: 30,
  targetResults: 8,
  rrfK: 60,
  mmrLambda: 0.6,
  minDistinctSources: 3,
  rerank: 'off',
  llmRerankPoolSize: 12,
} as const satisfies Required<RetrievalOptions>;

/** Output of {@link HybridRetriever.search}. */
export interface RetrievalResult {
  /** Final ranked chunks, size ≤ `targetResults`. */
  readonly chunks: readonly RetrievedChunk[];
  /** Telemetry for logs / observability. */
  readonly debug: RetrievalDebug;
}

/** Per-stage observability data. Use it for logs, not as a public API. */
export interface RetrievalDebug {
  readonly phoneId: string;
  readonly query: string;
  readonly vector: { readonly count: number; readonly ms: number };
  readonly fts: { readonly count: number; readonly ms: number };
  readonly rrf: { readonly count: number; readonly ms: number };
  readonly mmr: { readonly count: number; readonly ms: number };
  readonly coverage: { readonly sourceCount: number; readonly relaxed: boolean };
  /**
   * Present when {@link RetrievalOptions.rerank} was `'llm'`.
   * `applied: false` means the pipeline fell back to MMR order only.
   */
  readonly llmRerank?: {
    readonly ms: number;
    readonly poolSize: number;
    readonly applied: boolean;
    readonly fallback?: string;
  };
  readonly totalMs: number;
}

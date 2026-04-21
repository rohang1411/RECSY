/**
 * Reciprocal Rank Fusion (RRF).
 *
 * Given N ranked lists of retrieved chunks, produces a single ranked list
 * in which each chunk's fused score is the sum over all lists of
 * `1 / (k + rank_in_list)`. A chunk missing from a list contributes 0
 * from that list. Ties in the output are broken by input-order stability.
 *
 * Why RRF and not score-normalised fusion?
 *   - Cosine similarity and `ts_rank_cd` live on wildly different scales
 *     and drift as the corpus grows. Normalising them correctly is a
 *     moving target. RRF sidesteps the problem: only the **rank** from
 *     each retriever is used.
 *   - Robust default `k = 60` (Cormack et al. 2009) works across many
 *     corpus sizes.
 *   - 15 lines. Testable. Predictable.
 *
 * Reference: Cormack, G.V., Clarke, C.L.A., & Buettcher, S. (2009).
 * "Reciprocal rank fusion outperforms condorcet and individual rank
 * learning methods." SIGIR '09.
 */
import type { RetrievedChunk } from './types';

/** Options for {@link reciprocalRankFusion}. */
export interface RrfOptions {
  /**
   * Smoothing constant. 60 is the literature standard and works well
   * across retrievers of different reliability. Larger = tail ranks
   * matter less.
   */
  readonly k?: number;
}

/** Output of {@link reciprocalRankFusion}. */
export interface FusedChunk extends RetrievedChunk {
  /** The fused RRF score: `Σ 1/(k + rank_i)` across the input lists. */
  readonly score: number;
  /** Per-retriever rank contributions for debugging. 1-indexed. */
  readonly rrfContributions: ReadonlyArray<{
    readonly retriever: string;
    readonly rank: number;
  }>;
}

const DEFAULT_K = 60;

/**
 * Fuse multiple ranked lists into one.
 *
 * - Inputs may share chunk IDs; their contributions add.
 * - Inputs are **assumed** pre-sorted best-first. We do not re-sort.
 * - The returned list is sorted by fused score desc, with input-order
 *   stability on ties (first retriever that surfaced the chunk wins).
 * - `RetrievedChunk` metadata (text, source, embedding) is taken from
 *   the **first** occurrence across the input lists. This matches
 *   intuition: "vector retriever's view of the chunk first, then FTS's"
 *   if vector is listed first. In practice these are identical rows.
 *
 * The function is **pure**: no I/O, no mutation of inputs.
 */
export function reciprocalRankFusion(
  lists: ReadonlyArray<{
    readonly retriever: string;
    readonly chunks: readonly RetrievedChunk[];
  }>,
  opts: RrfOptions = {},
): readonly FusedChunk[] {
  const k = opts.k ?? DEFAULT_K;

  /**
   * Map from chunkId → accumulator. We use a Map to preserve insertion
   * order so ties break consistently on the first retriever that saw
   * the chunk.
   */
  const accum = new Map<
    string,
    {
      chunk: RetrievedChunk;
      score: number;
      contributions: Array<{ retriever: string; rank: number }>;
    }
  >();

  for (const { retriever, chunks } of lists) {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const rank = i + 1; // 1-indexed per RRF convention
      const contribution = 1 / (k + rank);

      const existing = accum.get(chunk.chunkId);
      if (existing) {
        existing.score += contribution;
        existing.contributions.push({ retriever, rank });
      } else {
        accum.set(chunk.chunkId, {
          chunk,
          score: contribution,
          contributions: [{ retriever, rank }],
        });
      }
    }
  }

  // Stable sort by RRF score desc. Array.prototype.sort in V8 is stable
  // since Node 12, so equal-score rows retain insertion order.
  return Array.from(accum.values())
    .sort((a, b) => b.score - a.score)
    .map<FusedChunk>(({ chunk, score, contributions }) => ({
      ...chunk,
      score,
      rrfContributions: contributions,
    }));
}

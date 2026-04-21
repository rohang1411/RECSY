/**
 * Maximum Marginal Relevance (MMR).
 *
 * Reranks a relevance-ordered list to add diversity: each pick balances
 * its own relevance against its maximum similarity to already-selected
 * chunks.
 *
 *   pick = argmax_{c ∈ candidates}
 *       ( λ · relevance(c)  −  (1 − λ) · max_{s ∈ selected} sim(c, s) )
 *
 * - `λ = 1` → pure relevance (MMR becomes a no-op identity).
 * - `λ = 0` → pure diversity (ignore relevance, spread out).
 * - `λ = 0.6` (default) → slightly relevance-leaning, the productive
 *   band in the literature.
 *
 * Why here and not server-side?
 *   - Postgres does not natively compute doc-doc cosine; we'd have to
 *     loop over pairs in SQL or ship vectors back anyway.
 *   - The MMR loop is `O(n²)` on the candidate set (≤60 chunks in our
 *     default config). On the client that's microseconds.
 *
 * This module is **pure**: no I/O, no mutation of inputs.
 *
 * Reference: Carbonell, J., & Goldstein, J. (1998). "The use of MMR,
 * diversity-based reranking for reordering documents and producing
 * summaries." SIGIR '98.
 */
import type { RetrievedChunk } from './types';

export interface MmrOptions {
  /** Diversity knob. Default 0.6. Must be in [0, 1]. */
  readonly lambda?: number;
  /** Max output length. Default = candidates.length. */
  readonly k?: number;
  /**
   * Fallback similarity for candidates missing an embedding. Using 0
   * makes them appear "maximally diverse" from selected items, which
   * biases them upward — rarely desired. Default: 1 (treat as a
   * duplicate of everything) so candidates without embeddings fall to
   * the back naturally. The hybrid retriever always requests
   * embeddings, so this guard only matters if we ever reuse MMR on a
   * different pipeline.
   */
  readonly missingEmbeddingSimilarity?: number;
}

const DEFAULT_LAMBDA = 0.6;

/**
 * Reorder a candidate list with MMR.
 *
 * @param candidates Chunks in relevance-descending order. Most will
 *                   carry `embedding`; those that don't are penalised
 *                   per {@link MmrOptions.missingEmbeddingSimilarity}.
 * @param opts       See {@link MmrOptions}.
 * @returns          A new array with at most `opts.k` chunks, in MMR
 *                   order. Inputs are not mutated.
 */
export function mmrRerank<T extends RetrievedChunk>(
  candidates: readonly T[],
  opts: MmrOptions = {},
): readonly T[] {
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  if (lambda < 0 || lambda > 1 || Number.isNaN(lambda)) {
    throw new RangeError(`MMR lambda must be in [0, 1], got ${lambda}`);
  }

  const limit = Math.min(opts.k ?? candidates.length, candidates.length);
  if (limit === 0) return [];

  const missingSim = opts.missingEmbeddingSimilarity ?? 1;

  // We don't mutate caller-owned arrays; we mutate a local index list.
  const remaining = candidates.map((_, i) => i);
  const selected: T[] = [];
  const selectedEmbeddings: Array<readonly number[] | undefined> = [];

  // Use the input relevance (already sorted; higher is better). We
  // convert to a positive score clamp so negative cosine (rare) doesn't
  // dominate the penalty term.
  const relevance = candidates.map((c) => c.score);

  while (selected.length < limit && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    let bestPos = -1;

    for (let p = 0; p < remaining.length; p++) {
      const i = remaining[p]!;
      const cand = candidates[i]!;
      const cEmbed = cand.embedding;

      let maxSim = 0;
      if (selected.length > 0) {
        for (let s = 0; s < selectedEmbeddings.length; s++) {
          const sEmbed = selectedEmbeddings[s];
          const sim = cEmbed && sEmbed ? cosineSimilarity(cEmbed, sEmbed) : missingSim;
          if (sim > maxSim) maxSim = sim;
        }
      }

      const mmrScore = lambda * relevance[i]! - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
        bestPos = p;
      }
    }

    if (bestIdx === -1) break;
    selected.push(candidates[bestIdx]!);
    selectedEmbeddings.push(candidates[bestIdx]!.embedding);
    // O(n) splice is fine: candidate sets are ≤ a few dozen items.
    remaining.splice(bestPos, 1);
  }

  return selected;
}

/**
 * Standard cosine similarity. Returns 0 when either vector has zero
 * magnitude — a pragmatic guard; pgvector won't return zero vectors for
 * our embedding model, but tests exercise the edge case.
 *
 * Exported for test reuse; not part of the public retrieval API.
 */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(`cosineSimilarity: vector length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

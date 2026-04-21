/**
 * Source-coverage clamp.
 *
 * Problem: RRF + MMR can still return all-from-one-source in the top-K
 * when a single article dominates the corpus for this phone. RECSY's
 * product promise is "multiple voices" — so we enforce a soft diversity
 * floor on **sources**, not just chunk embeddings.
 *
 * Algorithm:
 *   1. Walk the ranked list top-down, always keeping the next chunk
 *      unless taking it would exceed `maxPerSource` for that source.
 *   2. If the final selection has fewer than `minDistinctSources` and
 *      the corpus actually contains more, back-fill with the highest-
 *      ranked skipped chunks from unseen sources.
 *   3. If the corpus can't clear the floor (e.g. phone only has 1 or 2
 *      sources), return whatever we have with `relaxed: true` set for
 *      the caller to log.
 *
 * This is pure and local: no DB, no mutation of inputs.
 */
import type { RetrievedChunk } from './types';

export interface CoverageOptions {
  /** Final list size (≤ ranked.length). */
  readonly k: number;
  /** Minimum distinct `sources.id` required in the output when possible. */
  readonly minDistinctSources: number;
  /** Hard cap on chunks per source. Default: floor(k / minDistinctSources). */
  readonly maxPerSource?: number;
}

export interface CoverageResult<T extends RetrievedChunk> {
  readonly chunks: readonly T[];
  /** True when we couldn't meet `minDistinctSources` because the ranked input didn't contain enough distinct sources. */
  readonly relaxed: boolean;
  /** Number of distinct sources in the output. */
  readonly sourceCount: number;
}

/**
 * Enforce source-diversity coverage on a ranked chunk list.
 *
 * Algorithm (two passes):
 *   1. Greedy pick respecting `maxPerSource` (a hard cap).
 *   2. If we still haven't met `minDistinctSources`, displace the
 *      lowest-ranked chunk from the most-represented source and promote
 *      an unseen-source candidate from the deferred pile. Repeat until
 *      the floor is met or the ranked input genuinely lacks enough
 *      distinct sources.
 *
 * The key design choice is **ceil** on the default `maxPerSource`:
 *
 *     maxPerSource = max(1, ceil(k / effectiveMinSources))
 *
 * With `k=4, minDistinctSources=3` this gives `maxPerSource = 2`, which
 * permits one source to contribute a second chunk while still leaving
 * room for two other sources — i.e. you actually fill all 4 slots with
 * 3 distinct sources. `floor` (=1) would leave a slot empty. Callers
 * who want a strict cap pass `maxPerSource` explicitly.
 */
export function enforceSourceCoverage<T extends RetrievedChunk>(
  ranked: readonly T[],
  opts: CoverageOptions,
): CoverageResult<T> {
  const { k, minDistinctSources } = opts;
  if (ranked.length === 0 || k === 0) {
    return { chunks: [], relaxed: false, sourceCount: 0 };
  }

  const uniqueSourcesAvailable = new Set(ranked.map((c) => c.sourceId)).size;
  const effectiveMinSources = Math.min(minDistinctSources, uniqueSourcesAvailable);
  const maxPerSource =
    opts.maxPerSource ?? Math.max(1, Math.ceil(k / Math.max(1, effectiveMinSources)));

  const countBySource = new Map<string, number>();
  const picked: T[] = [];
  const deferred: T[] = [];

  // Pass 1: greedy pick up to k, respecting maxPerSource.
  for (const chunk of ranked) {
    if (picked.length >= k) break;
    const n = countBySource.get(chunk.sourceId) ?? 0;
    if (n < maxPerSource) {
      picked.push(chunk);
      countBySource.set(chunk.sourceId, n + 1);
    } else {
      deferred.push(chunk);
    }
  }

  // Pass 2: displace-and-promote to meet the source-diversity floor.
  //
  // Only runs if we're still short of `effectiveMinSources`. Each
  // iteration drops one chunk from the most-represented source and adds
  // one chunk from a not-yet-seen source, preserving `picked.length`.
  if (countBySource.size < effectiveMinSources) {
    for (const cand of deferred) {
      if (countBySource.size >= effectiveMinSources) break;
      if (countBySource.has(cand.sourceId)) continue; // need a fresh source

      let victimSource: string | null = null;
      let victimCount = 0;
      for (const [src, n] of countBySource) {
        if (n > victimCount) {
          victimSource = src;
          victimCount = n;
        }
      }
      // If no source has ≥2 chunks, we can't displace without dropping
      // below `minDistinctSources`. Give up and flag as relaxed.
      if (victimSource == null || victimCount <= 1) break;

      for (let i = picked.length - 1; i >= 0; i--) {
        if (picked[i]!.sourceId === victimSource) {
          picked.splice(i, 1);
          countBySource.set(victimSource, victimCount - 1);
          break;
        }
      }
      picked.push(cand);
      countBySource.set(cand.sourceId, 1);
    }
  }

  return {
    chunks: picked,
    relaxed: countBySource.size < minDistinctSources,
    sourceCount: countBySource.size,
  };
}

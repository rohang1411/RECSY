/**
 * Hybrid retriever — composes vector + FTS + RRF + MMR + source coverage.
 *
 * Single entry point: {@link HybridRetriever.search}.
 *
 * High-level flow (matches ADR 0004):
 *
 *   1. Embed the query once via {@link LlmProvider.embed}.
 *   2. In parallel, run `VectorSearch` (cosine) and `FtsSearch` (tsvector
 *      with trigram fallback). Each returns up to `kPerRetriever` chunks.
 *   3. Fuse the two ranked lists with Reciprocal Rank Fusion.
 *   4. Rerank the top of the fused list with MMR to break near-duplicates.
 *   5. Apply source-coverage clamp so ≥3 distinct sources appear in the
 *      final set when the corpus can support it.
 *   6. Return `RetrievalResult` with per-stage timing for logs.
 *
 * Optional LLM rerank (ADR 0004) runs after MMR when
 * {@link RetrievalOptions.rerank} is `'llm'`, then coverage still runs on
 * the merged list (LLM head + MMR tail) so the diversity floor can apply.
 */
import type { Logger } from 'pino';

import { toAppError, ValidationError } from '@/lib/errors';
import type { LlmProvider } from '@/services/llm/types';

import { enforceSourceCoverage } from './coverage';
import { llmRerankChunkOrder, mergeLlmHeadWithMmrTail } from './llm-rerank';
import { mmrRerank } from './mmr';
import { reciprocalRankFusion } from './rrf';
import type {
  RetrievalDebug,
  RetrievalOptions,
  RetrievalRequest,
  RetrievalResult,
  RetrievedChunk,
  Retriever,
} from './types';
import { DEFAULT_OPTIONS } from './types';

export interface HybridRetrieverDeps {
  readonly vector: Retriever;
  readonly fts: Retriever;
  readonly llm: LlmProvider;
  readonly log: Logger;
  /**
   * Embedding model name. Falls back to the provider default.
   * Exposed as a dep so tests can swap in a stub provider without
   * depending on env.
   */
  readonly embeddingModel?: string;
}

/** Parameters accepted by {@link HybridRetriever.search}. */
export interface HybridSearchInput extends Omit<RetrievalRequest, 'k' | 'queryEmbedding'> {
  readonly options?: RetrievalOptions;
}

export class HybridRetriever {
  constructor(private readonly deps: HybridRetrieverDeps) {}

  async search(input: HybridSearchInput): Promise<RetrievalResult> {
    const start = performance.now();
    const { phoneId, query } = input;
    const opts = resolveOptions(input.options);

    if (!query || !query.trim()) {
      throw new ValidationError('HybridRetriever.search: query must be non-empty', {
        phoneId,
      });
    }

    const log = this.deps.log.child({ phoneId, retriever: 'hybrid' });
    log.debug({ opts }, 'hybrid retrieval begin');

    // Step 1: embed the query. Done up-front so vector + FTS can run in
    // parallel with the same input object.
    const queryEmbedding = await this.embedQuery(query);

    // Step 2: parallel vector + FTS.
    const vectorStart = performance.now();
    const ftsStart = performance.now();
    const [vectorChunks, ftsChunks] = await Promise.all([
      this.deps.vector
        .search({
          phoneId,
          query,
          k: opts.kPerRetriever,
          queryEmbedding,
        })
        .catch((err) => {
          log.warn({ err: toAppError(err).message }, 'vector retriever failed');
          return [] as readonly RetrievedChunk[];
        }),
      this.deps.fts.search({ phoneId, query, k: opts.kPerRetriever }).catch((err) => {
        log.warn({ err: toAppError(err).message }, 'fts retriever failed');
        return [] as readonly RetrievedChunk[];
      }),
    ]);

    const vectorMs = performance.now() - vectorStart;
    const ftsMs = performance.now() - ftsStart;

    if (vectorChunks.length === 0 && ftsChunks.length === 0) {
      log.info({ query }, 'hybrid retrieval returned no candidates');
      return buildResult({
        phoneId,
        query,
        vectorMs,
        ftsMs,
        vectorCount: 0,
        ftsCount: 0,
        final: [],
        relaxed: false,
        sourceCount: 0,
        start,
      });
    }

    // Step 3: RRF.
    const rrfStart = performance.now();
    const fused = reciprocalRankFusion(
      [
        { retriever: 'vector', chunks: vectorChunks },
        { retriever: 'fts', chunks: ftsChunks },
      ],
      { k: opts.rrfK },
    );
    const rrfMs = performance.now() - rrfStart;

    // Step 4: MMR. Only the FTS retriever lacks embeddings; merging we
    // need embeddings where available. The fused list inherits metadata
    // from the first retriever to surface each chunk — that's the vector
    // retriever in our pipeline, so embeddings are present for anything
    // vector found. FTS-only chunks fall back to the penalty path, which
    // is acceptable: they're exact-keyword matches, typically few, and
    // distinct from each other by definition.
    const mmrStart = performance.now();
    const mmrCap = Math.min(opts.targetResults * 3, fused.length);
    const mmrRanked = mmrRerank(fused.slice(0, mmrCap), {
      lambda: opts.mmrLambda,
      k: opts.targetResults * 2,
    });
    const mmrMs = performance.now() - mmrStart;

    // Step 5 (optional): LLM rerank — replace MMR prefix when successful.
    let rankedForCoverage = mmrRanked;
    let llmRerankTelemetry: RetrievalDebug['llmRerank'] | undefined;

    if (opts.rerank === 'llm' && mmrRanked.length >= opts.targetResults) {
      const rrStart = performance.now();
      const rerank = await llmRerankChunkOrder({
        llm: this.deps.llm,
        query,
        pool: mmrRanked,
        targetResults: opts.targetResults,
        poolSizeCap: opts.llmRerankPoolSize,
      });
      const wallMs = performance.now() - rrStart;

      if (rerank.ok) {
        rankedForCoverage = mergeLlmHeadWithMmrTail(rerank.result.orderedChunks, mmrRanked);
        llmRerankTelemetry = {
          ms: rerank.result.ms,
          poolSize: Math.min(opts.llmRerankPoolSize, mmrRanked.length),
          applied: true,
        };
        log.debug({ llmRerankMs: rerank.result.ms, wallMs }, 'llm rerank applied');
      } else {
        llmRerankTelemetry = {
          ms: rerank.ms,
          poolSize: Math.min(opts.llmRerankPoolSize, mmrRanked.length),
          applied: false,
          fallback: rerank.reason,
        };
        log.warn({ reason: rerank.reason, wallMs }, 'llm rerank failed; using MMR order');
      }
    }

    // Step 6: source coverage clamp.
    const coverage = enforceSourceCoverage(rankedForCoverage, {
      k: opts.targetResults,
      minDistinctSources: opts.minDistinctSources,
    });

    const result = buildResult({
      phoneId,
      query,
      vectorMs,
      ftsMs,
      rrfMs,
      mmrMs,
      vectorCount: vectorChunks.length,
      ftsCount: ftsChunks.length,
      final: coverage.chunks,
      relaxed: coverage.relaxed,
      sourceCount: coverage.sourceCount,
      start,
      llmRerank: llmRerankTelemetry,
    });

    log.info(
      {
        finalCount: result.chunks.length,
        sourceCount: coverage.sourceCount,
        relaxed: coverage.relaxed,
        totalMs: result.debug.totalMs,
      },
      'hybrid retrieval complete',
    );

    return result;
  }

  private async embedQuery(query: string): Promise<readonly number[]> {
    const { llm, embeddingModel } = this.deps;
    const { embeddings } = await llm.embed([query], embeddingModel);
    const vec = embeddings[0];
    if (!vec || vec.length === 0) {
      throw toAppError(new Error('embed() returned empty result for query'));
    }
    return vec;
  }
}

function resolveOptions(partial: RetrievalOptions | undefined): Required<RetrievalOptions> {
  return {
    ...DEFAULT_OPTIONS,
    ...(partial ?? {}),
  };
}

interface BuildResultArgs {
  readonly phoneId: string;
  readonly query: string;
  readonly vectorMs: number;
  readonly ftsMs: number;
  readonly rrfMs?: number;
  readonly mmrMs?: number;
  readonly vectorCount: number;
  readonly ftsCount: number;
  readonly final: readonly RetrievedChunk[];
  readonly relaxed: boolean;
  readonly sourceCount: number;
  readonly start: number;
  readonly llmRerank?: RetrievalDebug['llmRerank'];
}

function buildResult(args: BuildResultArgs): RetrievalResult {
  return {
    chunks: args.final,
    debug: {
      phoneId: args.phoneId,
      query: args.query,
      vector: { count: args.vectorCount, ms: args.vectorMs },
      fts: { count: args.ftsCount, ms: args.ftsMs },
      rrf: { count: args.final.length, ms: args.rrfMs ?? 0 },
      mmr: { count: args.final.length, ms: args.mmrMs ?? 0 },
      coverage: { sourceCount: args.sourceCount, relaxed: args.relaxed },
      ...(args.llmRerank !== undefined ? { llmRerank: args.llmRerank } : {}),
      totalMs: performance.now() - args.start,
    },
  };
}

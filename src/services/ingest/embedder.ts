/**
 * Batched embeddings for ingestion chunks.
 *
 * Wraps `LlmProvider.embed` with:
 *   - batching (Gemini accepts up to 100 texts per request; we use 50 to
 *     leave headroom for prompt overhead),
 *   - concurrency limit (one in-flight batch by default to avoid exhausting
 *     the free-tier rate limit),
 *   - exponential backoff via `p-retry` for transient 429/5xx errors.
 *
 * Returns embeddings in the same order as the input texts.
 */
import pLimit from 'p-limit';
import pRetry from 'p-retry';

import { logger } from '@/services/logger';

import type { LlmProvider } from '../llm/types';

export interface EmbedderOptions {
  readonly batchSize?: number;
  readonly concurrency?: number;
  readonly retries?: number;
  readonly model?: string;
}

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_CONCURRENCY = 1;
const DEFAULT_RETRIES = 3;

export class ChunkEmbedder {
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly retries: number;
  private readonly model: string | undefined;
  private readonly log = logger.child({ component: 'ingest.embedder' });

  constructor(
    private readonly llm: LlmProvider,
    opts: EmbedderOptions = {},
  ) {
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
    this.retries = opts.retries ?? DEFAULT_RETRIES;
    this.model = opts.model;
  }

  /** Embed `texts` in input order. The returned arrays match position-wise. */
  async embedAll(texts: readonly string[]): Promise<{
    embeddings: number[][];
    model: string;
    tokensIn: number;
  }> {
    if (texts.length === 0) {
      return { embeddings: [], model: this.model ?? 'unknown', tokensIn: 0 };
    }

    const batches = chunkArray(texts, this.batchSize);
    const limit = pLimit(this.concurrency);
    let totalTokens = 0;
    let resolvedModel = this.model ?? 'unknown';

    const results = await Promise.all(
      batches.map((batch, batchIdx) =>
        limit(async () => {
          const result = await pRetry(
            async () => {
              return this.llm.embed(batch, this.model, {
                area: 'Ingestion',
                feature: 'Chunk embedding',
                source: 'ChunkEmbedder',
                metadata: { batchSize: batch.length },
              });
            },
            {
              retries: this.retries,
              minTimeout: 1_000,
              maxTimeout: 10_000,
              onFailedAttempt: (ctx) => {
                // `ctx.error` is the thrown error from the underlying LLM
                // call; without logging it, retries look opaque and debugging
                // is painful. `error.cause` surfaces the SDK-level detail
                // (HTTP status, schema violation, etc.).
                const err = ctx.error;
                const cause = (err as { cause?: unknown }).cause;
                const causeMsg =
                  cause instanceof Error ? `${cause.name}: ${cause.message}` : undefined;
                this.log.warn(
                  {
                    batchIdx,
                    attempt: ctx.attemptNumber,
                    err: err.message,
                    cause: causeMsg,
                  },
                  'embed batch failed, retrying',
                );
              },
            },
          );
          totalTokens += result.usage.tokensIn;
          resolvedModel = result.model;
          // Convert ReadonlyArray<ReadonlyArray<number>> → number[][].
          return result.embeddings.map((e) => [...e]);
        }),
      ),
    );

    const embeddings = results.flat();
    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`,
      );
    }
    return { embeddings, model: resolvedModel, tokensIn: totalTokens };
  }
}

function chunkArray<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

import { LlmError } from '@/lib/errors';

export interface ProviderBudgetOptions {
  readonly maxGenerationRequests: number;
  readonly maxEmbeddingRequests: number;
  readonly stopOnQuota?: boolean;
}

/** Counts transport attempts, including SDK retries and key fallback. */
export class ProviderRequestBudget {
  private generation = 0;
  private embedding = 0;
  private quotaStopped = false;
  readonly attempts: Array<{ operation: string; status?: number; ms?: number; error?: string }> =
    [];
  constructor(private readonly limits: ProviderBudgetOptions) {
    for (const value of [limits.maxGenerationRequests, limits.maxEmbeddingRequests])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error('Provider budgets must be nonnegative integers');
  }
  readonly fetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const embedding = /embedContent|batchEmbedContents/i.test(url);
    const used = embedding ? this.embedding : this.generation;
    const maximum = embedding
      ? this.limits.maxEmbeddingRequests
      : this.limits.maxGenerationRequests;
    if (this.quotaStopped || used >= maximum)
      throw new LlmError('Evaluation provider budget stopped further requests', {
        operation: embedding ? 'embed' : 'generate',
        used,
        maximum,
        quotaStopped: this.quotaStopped,
      });
    if (embedding) this.embedding++;
    else this.generation++;
    const attempt: (typeof this.attempts)[number] = { operation: embedding ? 'embed' : 'generate' };
    this.attempts.push(attempt);
    const start = performance.now();
    try {
      const response = await fetch(input, init);
      attempt.status = response.status;
      if (response.status === 429 && this.limits.stopOnQuota) this.quotaStopped = true;
      return response;
    } catch (error) {
      attempt.error = error instanceof Error ? error.name : 'Unknown transport error';
      throw error;
    } finally {
      attempt.ms = performance.now() - start;
    }
  };
  snapshot() {
    return {
      generationRequests: this.generation,
      embeddingRequests: this.embedding,
      quotaStopped: this.quotaStopped,
      limits: this.limits,
      attempts: this.attempts,
    };
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProviderRequestBudget } from './request-budget';

afterEach(() => vi.unstubAllGlobals());
describe('transport evaluation budget', () => {
  it('counts concurrent attempts and forbids requests beyond the limit', async () => {
    const transport = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', transport);
    const budget = new ProviderRequestBudget({ maxGenerationRequests: 2, maxEmbeddingRequests: 1 });
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => budget.fetch('https://example.test/generateContent')),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(budget.snapshot().generationRequests).toBe(2);
    await budget.fetch('https://example.test/batchEmbedContents');
    await expect(budget.fetch('https://example.test/embedContent')).rejects.toThrow(
      'budget stopped',
    );
    expect(budget.snapshot().embeddingRequests).toBe(1);
  });
  it('stops all subsequent requests after a quota response', async () => {
    const transport = vi.fn(async () => new Response('{}', { status: 429 }));
    vi.stubGlobal('fetch', transport);
    const budget = new ProviderRequestBudget({
      maxGenerationRequests: 20,
      maxEmbeddingRequests: 12,
      stopOnQuota: true,
    });
    await budget.fetch('https://example.test/generateContent');
    await expect(budget.fetch('https://example.test/embedContent')).rejects.toThrow(
      'budget stopped',
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().quotaStopped).toBe(true);
  });
});

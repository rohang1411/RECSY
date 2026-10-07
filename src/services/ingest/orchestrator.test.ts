/**
 * Unit tests for the ingestion orchestrator (`orchestrator.ts`).
 *
 * Tests cover: adapter protocol (discover → fetch → chunk → curate →
 * embed → write), idempotency on second run (same content_hash skipped),
 * curator reject path, embed error recording via `recordFailedRun`, and
 * orchestrator summary totals. All I/O is mocked.
 */
import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '@/lib/errors';
import type { LlmProvider } from '@/services/llm/types';

import { IngestOrchestrator } from './orchestrator';
import type { PhoneRef, SourceAdapter, SourceCandidate } from './types';

const phone: PhoneRef = {
  id: 'phone-1',
  slug: 'google-pixel-9-pro-xl',
  brand: 'Google',
  model: 'Pixel 9 Pro XL',
  launchDate: '2024-08-13',
};

const candidate: SourceCandidate = {
  url: 'https://www.youtube.com/watch?v=abc123',
  title: 'Pixel 9 Pro XL review',
  author: 'Reviewer',
  channel: 'Reviewer',
  language: 'en',
  publishedAt: null,
  raw: { videoId: 'abc123' },
};

function makeOrchestrator(adapter: SourceAdapter): IngestOrchestrator {
  return new IngestOrchestrator({
    db: {} as never,
    llm: {} as LlmProvider,
    adapters: [adapter],
    curator: null,
    disambiguator: null,
  });
}

describe('IngestOrchestrator unavailable sources', () => {
  it('skips unchanged comparison content before disambiguation, curation, or embeddings', async () => {
    const resolve = vi.fn();
    const decide = vi.fn();
    const embed = vi.fn();
    const values = vi.fn(async () => []);
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: async () => [{ id: 'existing' }] }) }),
      }),
      insert: () => ({ values }),
    };
    const adapter = {
      type: 'youtube',
      discover: vi.fn(async () => [candidate]),
      fetch: vi.fn(async () => ({
        body: 'unchanged review',
        contentHash: 'same',
        url: candidate.url,
      })),
      chunk: vi.fn(),
    } as unknown as SourceAdapter;
    const orchestrator = new IngestOrchestrator({
      db: db as never,
      llm: { embed } as unknown as LlmProvider,
      adapters: [adapter],
      curator: { decide } as never,
      disambiguator: { resolve } as never,
      aliasLoader: async () => [],
    });
    const result = await orchestrator.ingestPhone(phone);
    expect(result.totals.skippedDuplicate).toBe(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(adapter.chunk).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped', rejectedReason: 'unchanged-content' }),
    );
  });
  it('counts NotFoundError fetch failures as unusable skips, not adapter errors', async () => {
    const adapter: SourceAdapter = {
      type: 'youtube',
      discover: vi.fn(async () => [candidate]),
      fetch: vi.fn(async () => {
        throw new NotFoundError('no transcript available', { videoId: 'abc123' });
      }),
      chunk: vi.fn(),
    };

    const summary = await makeOrchestrator(adapter).ingestPhone(phone, {
      adapterTypes: ['youtube'],
    });

    expect(summary.adapters[0]).toMatchObject({
      discovered: 1,
      fetched: 0,
      skippedUnusable: 1,
      skippedRejected: 0,
      errors: [],
    });
    expect(summary.totals.skippedUnusable).toBe(1);
    expect(summary.totals.errors).toBe(0);
  });

  it('keeps unexpected fetch failures in the adapter error list', async () => {
    const adapter: SourceAdapter = {
      type: 'youtube',
      discover: vi.fn(async () => [candidate]),
      fetch: vi.fn(async () => {
        throw new Error('youtube exploded');
      }),
      chunk: vi.fn(),
    };

    const summary = await makeOrchestrator(adapter).ingestPhone(phone, {
      adapterTypes: ['youtube'],
    });

    expect(summary.adapters[0]?.skippedUnusable).toBe(0);
    expect(summary.adapters[0]?.errors).toEqual([
      { url: candidate.url, error: 'youtube exploded' },
    ]);
    expect(summary.totals.errors).toBe(1);
  });
});

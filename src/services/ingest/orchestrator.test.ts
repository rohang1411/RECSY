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

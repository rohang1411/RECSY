import { describe, expect, it } from 'vitest';
import type { RetrievedChunk } from '@/services/retrieval/types';
import { stratifyPassages } from './agent';

function makeMockChunk(opts: {
  id: string;
  ageDays?: number;
  role?: string;
  text?: string;
  temporalCategory?: string;
}): RetrievedChunk {
  const publishedAt =
    opts.ageDays != null ? new Date(Date.now() - opts.ageDays * 24 * 60 * 60 * 1000) : new Date();

  return {
    chunkId: opts.id,
    sourceId: `src-${opts.id}`,
    text: opts.text ?? `Sample chunk text for ${opts.id}`,
    score: 0.85,
    source: {
      id: `src-${opts.id}`,
      url: `https://example.com/${opts.id}`,
      title: `Source Title ${opts.id}`,
      type: 'youtube',
      author: 'Tech Reviewer',
      channel: 'Tech Channel',
      publishedAt,
      temporalCategory: opts.temporalCategory ?? 'general',
    },
    metadata: opts.role ? { role: opts.role } : {},
  };
}

describe('stratifyPassages', () => {
  it('guarantees at least 2 retrospective passages when available alongside dense baseline passages', () => {
    // 8 launch chunks (age 10 days)
    const baselineChunks: RetrievedChunk[] = Array.from({ length: 8 }, (_, i) =>
      makeMockChunk({ id: `launch-${i}`, ageDays: 10 }),
    );

    // 3 retrospective chunks (age 180 days)
    const retroChunks: RetrievedChunk[] = [
      makeMockChunk({ id: 'retro-1', ageDays: 180, temporalCategory: 'long_term_6m' }),
      makeMockChunk({
        id: 'retro-2',
        ageDays: 200,
        text: '[COMPARISON EXCERPT: Comparing X vs Y]',
      }),
      makeMockChunk({ id: 'retro-3', role: 'secondary' }),
    ];

    const all = [...baselineChunks, ...retroChunks];
    const stratified = stratifyPassages(all, 8);

    expect(stratified).toHaveLength(8);
    const retroIncluded = stratified.filter((c) =>
      ['retro-1', 'retro-2', 'retro-3'].includes(c.chunkId),
    );
    expect(retroIncluded.length).toBeGreaterThanOrEqual(2);
    expect(retroIncluded.length).toBeLessThanOrEqual(3);
  });

  it('handles corpus with zero retrospective chunks cleanly', () => {
    const baselineChunks: RetrievedChunk[] = Array.from({ length: 6 }, (_, i) =>
      makeMockChunk({ id: `launch-${i}`, ageDays: 5 }),
    );

    const stratified = stratifyPassages(baselineChunks, 8);
    expect(stratified).toHaveLength(6);
    expect(stratified.map((c) => c.chunkId)).toEqual(baselineChunks.map((c) => c.chunkId));
  });

  it('handles corpus where all chunks are retrospective cleanly', () => {
    const retroChunks: RetrievedChunk[] = Array.from({ length: 5 }, (_, i) =>
      makeMockChunk({ id: `retro-${i}`, ageDays: 180 }),
    );

    const stratified = stratifyPassages(retroChunks, 8);
    expect(stratified).toHaveLength(5);
  });
});

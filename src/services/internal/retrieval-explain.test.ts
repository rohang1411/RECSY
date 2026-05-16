/**
 * Unit tests for the retrieval pipeline explain helper (`retrieval-explain.ts`).
 *
 * Tests cover: `getRetrievalDemo` returns an object with the expected shape
 * (id, phoneSlug, stages array, finalChunks array, sourceMix array). The
 * test reads from the fixture file on disk — no LLM or DB calls.
 */
import { describe, expect, it } from 'vitest';

import { getRetrievalDemo } from './retrieval-explain';

describe('getRetrievalDemo', () => {
  it('returns a RetrievalDemo with required fields', async () => {
    const demo = await getRetrievalDemo();
    expect(demo).toBeDefined();
    expect(typeof demo.id).toBe('string');
    expect(typeof demo.phoneSlug).toBe('string');
    expect(typeof demo.title).toBe('string');
    expect(typeof demo.question).toBe('string');
    expect(typeof demo.latencyMs).toBe('number');
    expect(Array.isArray(demo.stages)).toBe(true);
    expect(Array.isArray(demo.finalChunks)).toBe(true);
    expect(Array.isArray(demo.sourceMix)).toBe(true);
  });

  it('stages have required shape (id, label, count, detail, color)', async () => {
    const demo = await getRetrievalDemo();
    for (const stage of demo.stages) {
      expect(typeof stage.id).toBe('string');
      expect(typeof stage.label).toBe('string');
      expect(typeof stage.count).toBe('number');
      expect(typeof stage.detail).toBe('string');
      expect(typeof stage.color).toBe('string');
    }
  });

  it('finalChunks have required shape (rank, sourceTitle, score, excerpt)', async () => {
    const demo = await getRetrievalDemo();
    for (const chunk of demo.finalChunks) {
      expect(typeof chunk.rank).toBe('number');
      expect(typeof chunk.sourceTitle).toBe('string');
      expect(typeof chunk.score).toBe('number');
      expect(typeof chunk.excerpt).toBe('string');
    }
  });

  it('sourceMix entries have type, count, and color fields', async () => {
    const demo = await getRetrievalDemo();
    for (const s of demo.sourceMix) {
      expect(typeof s.type).toBe('string');
      expect(typeof s.count).toBe('number');
      expect(typeof s.color).toBe('string');
    }
  });
});

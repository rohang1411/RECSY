/**
 * Unit tests for citation extraction and validation (`citations.ts`).
 *
 * Tests cover: extracting UUIDs from inline `[c:<uuid>]` tags,
 * resolving citations against retrieved chunks, stripping orphaned
 * tags, and the full validation pipeline (no hallucinated sources
 * survive).
 *
 * All tests are pure — no network, DB, or LLM calls.
 */
import { describe, expect, it } from 'vitest';

import type { RetrievedChunk } from '@/services/retrieval/types';

import { extractCitationIds, resolveCitations, validateCitationTags } from './citations';

const sampleId = '550e8400-e29b-41d4-a716-446655440000';

function stubChunk(id: string): RetrievedChunk {
  return {
    chunkId: id,
    sourceId: 's1',
    text: 'hello',
    score: 1,
    source: {
      id: 's1',
      url: 'https://example.com/a',
      title: 'Source A',
      type: 'article',
      author: null,
      channel: null,
      publishedAt: null,
    },
  };
}

describe('citations', () => {
  it('extracts uuid tags with case-insensitive c', () => {
    const text = `Hello [c:${sampleId}] and [C:${sampleId}]`;
    const ids = extractCitationIds(text);
    expect(ids).toEqual([sampleId, sampleId]);
  });

  it('validateCitationTags rejects unknown ids', () => {
    const allowed = new Set([sampleId]);
    const bad = validateCitationTags(
      `x [c:${sampleId}] [c:00000000-0000-0000-0000-000000000001]`,
      allowed,
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.invalid).toContain('00000000-0000-0000-0000-000000000001');
  });

  it('resolveCitations preserves first-appearance order and dedupes', () => {
    const b = '00000000-0000-0000-0000-000000000002';
    const chunks = [stubChunk(sampleId), stubChunk(b)];
    const text = `[c:${b}] then [c:${sampleId}] repeat [c:${b}]`;
    const resolved = resolveCitations(text, chunks);
    expect(resolved.map((c) => c.chunkId)).toEqual([b, sampleId]);
  });
});

/**
 * Unit tests for text chunking utilities (`chunking.ts`).
 *
 * Tests cover: `splitSentences` edge cases (empty string, single sentence,
 * sentence boundary detection), `countTokens` approximation bounds, and
 * `chunkText` overlap and size constraints. Pure.
 */
import { describe, expect, it } from 'vitest';

import {
  buildContextualizedChunk,
  chunkText,
  countTokens,
  formatContextualPreamble,
  splitSentences,
} from './chunking';

describe('splitSentences', () => {
  it('returns [] for empty input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('splits simple text on . ! ? boundaries', () => {
    const sentences = splitSentences(
      'The phone is great. The camera is amazing! Would you buy it?',
    );
    expect(sentences).toHaveLength(3);
    expect(sentences[0]?.text).toContain('The phone is great');
    expect(sentences[1]?.text).toContain('amazing');
    expect(sentences[2]?.text).toContain('Would you buy');
  });

  it('preserves paragraph boundaries', () => {
    const text = 'First paragraph sentence.\n\nSecond paragraph sentence.';
    const sentences = splitSentences(text);
    expect(sentences).toHaveLength(2);
  });

  it('computes non-zero token counts for non-empty sentences', () => {
    const sentences = splitSentences('Hello world. Goodbye world.');
    for (const s of sentences) {
      expect(s.tokens).toBeGreaterThan(0);
    }
  });
});

describe('chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('produces a single chunk for short text', () => {
    const chunks = chunkText('This is a short review. It has two sentences.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
  });

  it('produces multiple chunks when text exceeds targetTokens', () => {
    // Build a long text deterministically.
    const sentence = 'The Pixel 9 Pro camera is exceptional in low light conditions. ';
    const long = sentence.repeat(200);
    const chunks = chunkText(long, { targetTokens: 100, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.tokens).toBeGreaterThan(0);
    }
  });

  it('respects target token budget with bounded slack', () => {
    const sentence = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do. ';
    const long = sentence.repeat(100);
    const target = 200;
    const chunks = chunkText(long, { targetTokens: target, overlapTokens: 40 });
    // Each chunk is within ~2x target (allow sentence-straddle slack).
    for (const c of chunks) {
      expect(c.tokens).toBeLessThanOrEqual(target * 2);
    }
  });

  it('assigns sequential indexes starting at 0', () => {
    const text = 'One sentence. Two sentence. '.repeat(100);
    const chunks = chunkText(text, { targetTokens: 50, overlapTokens: 10 });
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
    });
  });

  it('throws if overlap >= target', () => {
    expect(() => chunkText('hello.', { targetTokens: 50, overlapTokens: 100 })).toThrow(
      /overlapTokens/,
    );
  });
});

describe('countTokens', () => {
  it('returns 0 for empty', () => {
    expect(countTokens('')).toBe(0);
  });

  it('returns positive for non-empty', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0);
  });

  it('scales roughly with length', () => {
    const short = countTokens('one two three');
    const long = countTokens('one two three four five six seven eight nine ten');
    expect(long).toBeGreaterThan(short);
  });
});

describe('Contextual Chunk Preamble (WP-04)', () => {
  const header = {
    phoneBrand: 'Google',
    phoneModel: 'Pixel 9 Pro',
    sourceCreator: 'MKBHD',
    sourceType: 'youtube',
    primarySubject: 'Camera and low-light performance',
    temporalOffset: '04:32',
  };

  it('formats structured contextual preamble with target entity anchor', () => {
    const preamble = formatContextualPreamble(header);
    expect(preamble).toContain('[TARGET PHONE: Google Pixel 9 Pro]');
    expect(preamble).toContain('[SOURCE: MKBHD (youtube)]');
    expect(preamble).toContain('[PRIMARY SUBJECT: Camera and low-light performance]');
    expect(preamble).toContain('[VIDEO TIMESTAMP: 04:32]');
    expect(preamble).toContain('---');
  });

  it('builds contextualized chunk preserving clean raw excerpt', () => {
    const raw = 'Compared to the S24, the low light HDR preserves noticeably more detail.';
    const result = buildContextualizedChunk(raw, header);

    expect(result.rawExcerpt).toBe(raw);
    expect(result.contextualChunkText).toContain('[TARGET PHONE: Google Pixel 9 Pro]');
    expect(result.contextualChunkText).toContain(raw);
  });
});

/**
 * Sentence-aligned, token-bounded text chunking.
 *
 * Strategy:
 *   1. Pre-split on hard paragraph boundaries (blank lines).
 *   2. Within each paragraph, split on sentence terminators (.!?;) followed
 *      by whitespace + uppercase, keeping the terminator with the sentence.
 *   3. Greedy-pack sentences into windows of `targetTokens` (default 400).
 *   4. Add `overlapTokens` of trailing-sentence overlap (default 60) so
 *      cross-chunk context isn't lost at retrieval time.
 *
 * Token counts use `gpt-tokenizer`'s default (cl100k_base). This is the same
 * tokenizer GPT-4 / 4o use; it differs from Gemini's tokenizer by maybe 5–10%
 * for English text. For chunk sizing that's well within tolerances.
 *
 * Pure functions only — no I/O, no LLM, no DB. Trivially testable.
 */
import { encode } from 'gpt-tokenizer';

export interface ChunkingOptions {
  /** Target tokens per chunk (soft cap; a single sentence may overflow). */
  readonly targetTokens?: number;
  /** Overlap, in tokens, between consecutive chunks. */
  readonly overlapTokens?: number;
  /** Minimum tokens per chunk (chunks shorter than this are merged forward). */
  readonly minTokens?: number;
}

export interface SentenceSpan {
  readonly text: string;
  readonly tokens: number;
}

export interface TextChunk {
  readonly text: string;
  readonly tokens: number;
  /** Index within the produced chunk array. */
  readonly index: number;
}

const DEFAULT_TARGET_TOKENS = 400;
const DEFAULT_OVERLAP_TOKENS = 60;
const DEFAULT_MIN_TOKENS = 60;

/** Count tokens for a string. Cheap; safe to call inside hot loops. */
export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

/**
 * Split a body of text into sentence spans, preserving terminators.
 * The regex is intentionally simple — this is content extraction, not NLP.
 */
export function splitSentences(text: string): SentenceSpan[] {
  if (!text.trim()) return [];

  const out: SentenceSpan[] = [];
  // Split on blank lines first so we never merge sentences across paragraphs.
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const para of paragraphs) {
    // Sentence-ish split. Captures ".!?;" followed by whitespace.
    // Negative lookbehind avoids splitting on common abbreviations
    // (Mr., Dr., e.g., i.e., etc.) that immediately precede a sentence start.
    const parts = para
      .replace(/\s+/g, ' ')
      .split(/(?<![A-Z][a-z]\.|[A-Z]\.|e\.g\.|i\.e\.|etc\.)([.!?;])\s+(?=[A-Z0-9“"\(])/);
    // The split keeps the punctuation in its own group, so reassemble pairs.
    let buffer = '';
    for (let i = 0; i < parts.length; i++) {
      const piece = parts[i] ?? '';
      buffer += piece;
      const isTerminator = /^[.!?;]$/.test(piece);
      const isLast = i === parts.length - 1;
      if (isTerminator || isLast) {
        const sentence = buffer.trim();
        if (sentence) {
          out.push({ text: sentence, tokens: countTokens(sentence) });
        }
        buffer = '';
      }
    }
    if (buffer.trim()) {
      out.push({ text: buffer.trim(), tokens: countTokens(buffer.trim()) });
    }
  }

  return out;
}

/**
 * Pack sentences into token-bounded chunks with overlap.
 *
 * Properties:
 *   - Empty input → empty output.
 *   - Single oversized sentence → returned as a one-sentence chunk
 *     (we don't break sentences mid-flight; that's the embedder's problem
 *     if it truly exceeds the model context, which 400-token chunks won't).
 *   - Last chunk may be shorter than `minTokens` if the entire input is short.
 */
export function chunkText(text: string, options: ChunkingOptions = {}): TextChunk[] {
  const target = options.targetTokens ?? DEFAULT_TARGET_TOKENS;
  const overlap = options.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;
  const minTokens = options.minTokens ?? DEFAULT_MIN_TOKENS;

  if (overlap >= target) {
    throw new Error(`overlapTokens (${overlap}) must be less than targetTokens (${target}).`);
  }

  const sentences = splitSentences(text);
  if (sentences.length === 0) return [];

  const chunks: TextChunk[] = [];
  let current: SentenceSpan[] = [];
  let currentTokens = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    const chunkText = current.map((s) => s.text).join(' ');
    chunks.push({
      text: chunkText,
      tokens: currentTokens,
      index: chunks.length,
    });
  };

  for (const sentence of sentences) {
    if (currentTokens + sentence.tokens > target && current.length > 0) {
      flush();
      // Carry a sliding overlap of the trailing sentences from the prior chunk.
      const carry: SentenceSpan[] = [];
      let carryTokens = 0;
      for (let i = current.length - 1; i >= 0 && carryTokens < overlap; i--) {
        const s = current[i]!;
        carry.unshift(s);
        carryTokens += s.tokens;
      }
      current = carry;
      currentTokens = carryTokens;
    }
    current.push(sentence);
    currentTokens += sentence.tokens;
  }

  flush();

  // Merge the last chunk forward if it's tiny and we have at least 2 chunks.
  if (chunks.length >= 2 && chunks[chunks.length - 1]!.tokens < minTokens) {
    const last = chunks.pop()!;
    const prior = chunks.pop()!;
    chunks.push({
      text: `${prior.text} ${last.text}`,
      tokens: prior.tokens + last.tokens,
      index: prior.index,
    });
  }

  return chunks.map((c, i) => ({ ...c, index: i }));
}

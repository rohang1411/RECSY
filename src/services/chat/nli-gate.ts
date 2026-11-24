/**
 * Post-Generation NLI Entailment Gate & Sentence Verification (Plan 31 WP-06).
 *
 * Verifies that each factual sentence bearing a citation tag [c:uuid] is genuinely
 * entailed by the premise text of the cited chunk. Flags contradiction and neutral
 * statements, strips hallucinated citations, and calculates sentence-level entailment scores.
 */

import { extractCitationIds } from './citations';

export type NliClassification = 'ENTAILMENT' | 'NEUTRAL' | 'CONTRADICTION';

export interface SentenceNliResult {
  readonly sentence: string;
  readonly chunkId: string;
  readonly classification: NliClassification;
  readonly score: number;
  readonly reason?: string;
}

export interface EntailmentVerificationResult {
  readonly verifiedText: string;
  readonly supportedClaims: number;
  readonly unsupportedClaims: number;
  readonly entailmentScore: number; // 0.0 to 1.0
  readonly details: readonly SentenceNliResult[];
}

interface ChunkPremise {
  readonly chunkId: string;
  readonly text: string;
}

/**
 * Evaluates sentence-level entailment against cited chunk premise.
 */
export function verifySentenceEntailment(
  sentence: string,
  premiseText: string,
): { classification: NliClassification; score: number; reason?: string } {
  const sClean = sentence.toLowerCase().trim();
  const sWithoutTags = sClean.replace(/\[c:[0-9a-f-]+\]/gi, '').trim();
  const pClean = premiseText.toLowerCase().trim();

  // 1. Numerical contradiction check: numbers/measurements in hypothesis must match premise
  const numRegex = /\b\d+(?:\.\d+)?(?:\s*(?:mah|w|hz|mp|gb|tb|mm|g|nit|nits|k|x))?\b/g;
  const sNumbers = sWithoutTags.match(numRegex) ?? [];
  const pNumbers = new Set(pClean.match(numRegex) ?? []);

  for (const num of sNumbers) {
    if (!pNumbers.has(num) && !pClean.includes(num)) {
      return {
        classification: 'CONTRADICTION',
        score: 0.1,
        reason: `numerical_mismatch (${num} not found in cited source)`,
      };
    }
  }

  // 2. Lexical term overlap
  const stopWords = new Set([
    'the',
    'is',
    'at',
    'which',
    'on',
    'and',
    'a',
    'an',
    'in',
    'it',
    'to',
    'for',
    'of',
    'with',
    'this',
    'that',
    'has',
  ]);
  const sTokens = sWithoutTags
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));

  if (sTokens.length === 0) {
    return { classification: 'ENTAILMENT', score: 1.0 };
  }

  let matches = 0;
  for (const token of sTokens) {
    if (pClean.includes(token)) {
      matches++;
    }
  }

  const overlapRatio = matches / sTokens.length;

  if (overlapRatio >= 0.5) {
    return { classification: 'ENTAILMENT', score: Math.min(1.0, 0.6 + overlapRatio * 0.4) };
  }

  if (overlapRatio >= 0.25) {
    return {
      classification: 'NEUTRAL',
      score: 0.4,
      reason: 'insufficient_premise_overlap',
    };
  }

  return {
    classification: 'CONTRADICTION',
    score: 0.1,
    reason: 'unrelated_premise',
  };
}

/**
 * Runs full post-generation NLI entailment gate across all cited sentences in text.
 */
export function verifyGeneratedAnswerEntailment(
  text: string,
  chunks: readonly ChunkPremise[],
): EntailmentVerificationResult {
  const chunksById = new Map<string, string>();
  for (const c of chunks) {
    chunksById.set(c.chunkId.toLowerCase(), c.text);
  }

  // Extract sentences
  const sentenceSpans = text.split(/(?<=[.!?])\s+/);
  const details: SentenceNliResult[] = [];
  let supportedClaims = 0;
  let unsupportedClaims = 0;
  let runningScoreTotal = 0;
  let evaluatedSentenceCount = 0;

  let verifiedText = text;

  for (const sent of sentenceSpans) {
    const citationIds = extractCitationIds(sent);
    if (citationIds.length === 0) continue;

    for (const rawId of citationIds) {
      const id = rawId.toLowerCase();
      evaluatedSentenceCount++;
      const premise = chunksById.get(id);

      if (!premise) {
        // Tag references non-existent chunk in context
        unsupportedClaims++;
        details.push({
          sentence: sent,
          chunkId: id,
          classification: 'CONTRADICTION',
          score: 0.0,
          reason: 'phantom_chunk_id',
        });
        // Strip invalid citation tag from verifiedText
        verifiedText = verifiedText.replace(new RegExp(`\\[c:${id}\\]`, 'gi'), '');
        continue;
      }

      const res = verifySentenceEntailment(sent, premise);
      runningScoreTotal += res.score;

      if (res.classification === 'ENTAILMENT') {
        supportedClaims++;
      } else {
        unsupportedClaims++;
        // Strip unentailed citation
        verifiedText = verifiedText.replace(new RegExp(`\\[c:${id}\\]`, 'gi'), '');
      }

      details.push({
        sentence: sent,
        chunkId: id,
        classification: res.classification,
        score: res.score,
        reason: res.reason,
      });
    }
  }

  // Clean up any double spaces caused by stripped tags
  verifiedText = verifiedText.replace(/\s{2,}/g, ' ').trim();

  const entailmentScore =
    evaluatedSentenceCount > 0
      ? Math.round((runningScoreTotal / evaluatedSentenceCount) * 1000) / 1000
      : 1.0;

  return {
    verifiedText,
    supportedClaims,
    unsupportedClaims,
    entailmentScore,
    details,
  };
}

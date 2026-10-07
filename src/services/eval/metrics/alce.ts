/**
 * Mechanical citation checks: ID membership, numeric-string presence, and
 * word overlap. These checks are not semantic entailment, ALCE, or FActScore.
 */
import type { CitationLexicalProxyResult, SentenceAttribution } from '../types';

const CITATION_REGEX = /\[c:([0-9a-fA-F-]{36}|[a-zA-Z0-9_-]+)\]/gi;

// Regular expressions to extract quantitative factual claims
const NUMERICAL_ENTITY_REGEX =
  /(?:\$\s*\d+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:mah|w|watts|hz|fps|mp|gb|tb|nits|mm|inches|inch|"|x|min|mins|minutes|hours|hr|hrs)\b|\b\d{4}\b)/gi;

export function extractInlineCitations(text: string): string[] {
  const matches: string[] = [];
  const regex = new RegExp(CITATION_REGEX.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m[1]) {
      matches.push(m[1].toLowerCase());
    }
  }
  return matches;
}

export function splitIntoSentences(text: string): string[] {
  // Strip code blocks and Markdown headers
  const cleaned = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^#+\s+.*$/gm, '')
    .trim();

  // Split on sentence-ending punctuation followed by whitespace or citation tag
  const rawSentences = cleaned.split(/(?<=[.!?])\s+(?=[A-Z0-9\[])/g);

  return rawSentences.map((s) => s.trim()).filter((s) => s.length > 5 && !s.startsWith('#'));
}

export function extractNumericalEntities(text: string): string[] {
  // Strip citation tags before checking for numbers to avoid treating UUIDs as factual specs
  const stripped = text.replace(CITATION_REGEX, '');
  const matches: string[] = [];
  const regex = new RegExp(NUMERICAL_ENTITY_REGEX.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = regex.exec(stripped)) !== null) {
    matches.push(m[0].trim().toLowerCase());
  }
  return matches;
}

const COMMON_STOPWORDS = new Set([
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'have',
  'has',
  'had',
  'phone',
  'device',
  'screen',
  'model',
  'about',
  'there',
  'their',
  'which',
  'would',
  'could',
  'should',
  'after',
  'before',
  'under',
  'above',
  'while',
  'where',
]);

export function verifyNumericalStringPresence(
  sentence: string,
  chunkTexts: readonly string[],
): { passed: boolean; missingEntities: string[] } {
  const cleanSentence = sentence.replace(CITATION_REGEX, '');
  const entities = extractNumericalEntities(cleanSentence);
  if (entities.length === 0) {
    return { passed: true, missingEntities: [] };
  }

  const combinedChunks = chunkTexts.join(' ').toLowerCase();
  const missing: string[] = [];

  for (const ent of entities) {
    // Normalise unit abbreviations (e.g. 5000mah -> 5000, $799 -> 799)
    const rawNumber = ent.replace(/[^0-9.]/g, '');
    if (!rawNumber) continue;

    // Use boundary matching so that '99' does not match inside '999' or '199'
    const escaped = rawNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const boundaryRegex = new RegExp(`(?:^|[^0-9.])${escaped}(?:[^0-9.]|$)`, 'i');
    if (!boundaryRegex.test(combinedChunks)) {
      missing.push(ent);
    }
  }

  return {
    passed: missing.length === 0,
    missingEntities: missing,
  };
}

export function chunkPassesLexicalProxy(sentence: string, chunkText: string): boolean {
  const cleanSentence = sentence.replace(CITATION_REGEX, '');

  // 1. Numeric strings must also appear in the chunk.
  const numCheck = verifyNumericalStringPresence(cleanSentence, [chunkText]);
  if (!numCheck.passed) return false;

  // 2. Meaningful content words must overlap
  const sentenceWords = cleanSentence
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !COMMON_STOPWORDS.has(w));

  if (sentenceWords.length === 0) return true;

  const chunkHaystack = chunkText.toLowerCase();
  let matchCount = 0;
  for (const word of sentenceWords) {
    if (chunkHaystack.includes(word)) matchCount++;
  }

  const overlapRatio = matchCount / sentenceWords.length;
  return overlapRatio >= 0.35;
}

export function evaluateCitationLexicalProxy(
  answerText: string,
  retrievedChunks: ReadonlyMap<string, string>,
): CitationLexicalProxyResult {
  const sentences = splitIntoSentences(answerText);
  const sentenceAttributions: SentenceAttribution[] = [];

  let totalCitations = 0;
  let lexicallyMatchedCitations = 0;
  let phantomCitations = 0;
  let citedSentences = 0;
  let lexicallyMatchedSentences = 0;

  for (const sentence of sentences) {
    const citations = extractInlineCitations(sentence);
    totalCitations += citations.length;

    let hasValidRefs = false;
    let passesLexicalProxy = false;
    let numericalPassed = true;
    let missingEntities: string[] = [];

    if (citations.length > 0) {
      citedSentences++;
      const associatedChunks: string[] = [];

      for (const cid of citations) {
        const chunkText = retrievedChunks.get(cid);
        if (chunkText) {
          hasValidRefs = true;
          associatedChunks.push(chunkText);
          if (chunkPassesLexicalProxy(sentence, chunkText)) {
            lexicallyMatchedCitations++;
          }
        } else {
          phantomCitations++;
        }
      }

      if (associatedChunks.length > 0) {
        const numCheck = verifyNumericalStringPresence(sentence, associatedChunks);
        numericalPassed = numCheck.passed;
        missingEntities = numCheck.missingEntities;

        // At least one cited chunk passes the lexical and numeric-string checks.
        passesLexicalProxy =
          numericalPassed && associatedChunks.some((c) => chunkPassesLexicalProxy(sentence, c));
      }
    }

    if (passesLexicalProxy) {
      lexicallyMatchedSentences++;
    }

    sentenceAttributions.push({
      sentence,
      citations,
      hasValidChunkRefs: hasValidRefs,
      passesLexicalProxy,
      numericalCheckPassed: numericalPassed,
      missingEntities,
    });
  }

  // Historical field name: fraction of citations passing the lexical proxy.
  const citePrec = totalCitations > 0 ? lexicallyMatchedCitations / totalCitations : 0.0;

  // Historical field name: fraction of sentences passing the lexical proxy.
  const citeRec = sentences.length > 0 ? lexicallyMatchedSentences / sentences.length : 0.0;

  // Phantom Citation Rate: Proportion of citations pointing to nonexistent chunks
  const phantomRate = totalCitations > 0 ? phantomCitations / totalCitations : 0.0;

  return {
    citePrec: Math.round(citePrec * 1000) / 1000,
    citeRec: Math.round(citeRec * 1000) / 1000,
    phantomRate: Math.round(phantomRate * 1000) / 1000,
    totalSentences: sentences.length,
    citedSentences,
    totalCitations,
    sentenceAttributions,
  };
}

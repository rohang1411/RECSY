/**
 * Development heuristics for answer text and citation checks. They rely on
 * keywords, numeric-string presence, and refusal phrases. They cannot judge
 * claim truth, completeness, semantic support, FSAR, or appropriate abstention.
 */

import {
  chunkPassesLexicalProxy,
  extractInlineCitations,
  extractNumericalEntities,
  splitIntoSentences,
  verifyNumericalStringPresence,
} from './alce';

export interface AnswerHeuristicInput {
  readonly query: string;
  readonly answerText: string;
  readonly retrievedChunks: ReadonlyMap<string, string>;
  readonly referenceFacts: readonly string[];
  readonly numericalEntities?: readonly string[];
}

export interface AnswerHeuristicResult {
  readonly isAnswerable: true;
  readonly appearsCompleteByKeywords: boolean;
  readonly passesHeuristicChecks: boolean;
  readonly lexicalCitationSupport: number;
  readonly lexicalReferenceCoverage: number;
  readonly numericalCheckPassed: boolean;
  readonly unmatchedReferenceFacts: readonly string[];
  readonly missingEntities: readonly string[];
  readonly unmatchedSentences: readonly string[];
  readonly violations: readonly string[];
}

export interface AbstentionHeuristicInput {
  readonly query: string;
  readonly answerText: string;
  readonly retrievedChunks: ReadonlyMap<string, string>;
  readonly expectedAbstentionReason?: string;
}

export interface AbstentionHeuristicResult {
  readonly isAnswerable: false;
  readonly hasAbstentionPhrase: boolean;
  readonly heuristicReason?: string;
  readonly violations: readonly string[];
}

const COMMON_ABSTENTION_PATTERNS = [
  /\b(?:do not have|don't have|no|insufficient)\s+(?:enough\s+)?(?:information|data|evidence|details|reviews|mentions?)\b/i,
  /\b(?:not mentioned|not provided|not available|cannot (?:confirm|verify|find|answer)|unable to find)\b/i,
  /\b(?:not enough (?:information|evidence|details)|corpus does not contain|reviews do not cover)\b/i,
  /\b(?:does not state|cannot determine)\b/i,
];

/**
 * Applies mechanical checks to an authored answerable case.
 */
export function evaluateAnswerHeuristics(input: AnswerHeuristicInput): AnswerHeuristicResult {
  const { answerText, retrievedChunks, referenceFacts, numericalEntities = [] } = input;
  const violations: string[] = [];
  const trimmed = answerText.trim();

  // 1. Guard against empty answers or failure strings
  if (!trimmed || trimmed.length < 20) {
    violations.push('Answer is empty or trivially short (<20 characters)');
    return {
      isAnswerable: true,
      appearsCompleteByKeywords: false,
      passesHeuristicChecks: false,
      lexicalCitationSupport: 0,
      lexicalReferenceCoverage: 0,
      numericalCheckPassed: false,
      unmatchedReferenceFacts: referenceFacts,
      missingEntities: numericalEntities,
      unmatchedSentences: ['Empty/trivial answer'],
      violations,
    };
  }

  // 2. Flag a refusal phrase on an authored answerable fixture.
  const looksLikeRefusal = COMMON_ABSTENTION_PATTERNS.some((p) => p.test(trimmed));
  if (looksLikeRefusal && referenceFacts.length > 0) {
    violations.push('Refusal phrase detected on an authored answerable case');
  }

  // 3. Keyword coverage of the authored reference-fact text.
  const answerLower = trimmed.toLowerCase();
  const unmatchedReferenceFacts: string[] = [];
  for (const fact of referenceFacts) {
    const factKeywords = fact
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3);

    if (factKeywords.length === 0) continue;
    const matchedKeywords = factKeywords.filter((k) => answerLower.includes(k));
    const coverage = matchedKeywords.length / factKeywords.length;
    if (coverage < 0.5) {
      unmatchedReferenceFacts.push(fact);
    }
  }

  const lexicalReferenceCoverage =
    referenceFacts.length > 0
      ? (referenceFacts.length - unmatchedReferenceFacts.length) / referenceFacts.length
      : 1.0;

  // 4. Numerical Entities Check
  const missingEntities: string[] = [];
  for (const expectedEnt of numericalEntities) {
    const rawNumber = expectedEnt.replace(/[^0-9.]/g, '');
    if (!rawNumber) continue;
    const escapedNumber = rawNumber.replace(/\./g, '\\.');
    const boundaryRegex = new RegExp(`(?:^|[^0-9.])${escapedNumber}(?:[^0-9.]|$)`, 'i');
    if (!boundaryRegex.test(trimmed)) {
      missingEntities.push(expectedEnt);
    }
  }
  const numericalCheckPassed = missingEntities.length === 0;
  if (!numericalCheckPassed) {
    violations.push(`Missing expected numerical entities: ${missingEntities.join(', ')}`);
  }

  // 5. Citation ID and lexical overlap checks.
  const sentences = splitIntoSentences(trimmed);
  let totalCitations = 0;
  let lexicallyMatchedCitations = 0;
  const unmatchedSentences: string[] = [];

  for (const sentence of sentences) {
    const citations = extractInlineCitations(sentence);
    const hasNumericalClaim = extractNumericalEntities(sentence).length > 0;
    const isMaterialFact = sentence.length > 25 || hasNumericalClaim;

    if (citations.length === 0) {
      if (isMaterialFact) {
        unmatchedSentences.push(`[Uncited sentence] "${sentence.slice(0, 80)}..."`);
        violations.push(`Long or numeric sentence lacks citation: "${sentence.slice(0, 80)}..."`);
      }
      continue;
    }

    totalCitations += citations.length;
    let sentenceMatchesLexically = false;

    for (const cid of citations) {
      const chunkText = retrievedChunks.get(cid);
      if (!chunkText) {
        violations.push(`Unknown citation ID [${cid}] points to no retrieved chunk`);
        continue;
      }

      if (chunkPassesLexicalProxy(sentence, chunkText)) {
        lexicallyMatchedCitations++;
        sentenceMatchesLexically = true;
      }
    }

    if (!sentenceMatchesLexically && isMaterialFact) {
      unmatchedSentences.push(`[Lexical mismatch] "${sentence.slice(0, 80)}..."`);
      violations.push(`Cited claim did not pass lexical overlap: "${sentence.slice(0, 80)}..."`);
    }
  }

  const lexicalCitationSupport =
    totalCitations > 0 ? lexicallyMatchedCitations / totalCitations : 0;
  const appearsCompleteByKeywords =
    lexicalReferenceCoverage >= 0.7 && numericalCheckPassed && !looksLikeRefusal;
  const passesHeuristicChecks =
    appearsCompleteByKeywords &&
    unmatchedSentences.length === 0 &&
    lexicalCitationSupport >= 0.8 &&
    totalCitations > 0;

  return {
    isAnswerable: true,
    appearsCompleteByKeywords,
    passesHeuristicChecks,
    lexicalCitationSupport: Math.round(lexicalCitationSupport * 1000) / 1000,
    lexicalReferenceCoverage: Math.round(lexicalReferenceCoverage * 1000) / 1000,
    numericalCheckPassed,
    unmatchedReferenceFacts,
    missingEntities,
    unmatchedSentences,
    violations,
  };
}

/**
 * Detects refusal phrases and numeric strings in an authored insufficient-evidence case.
 */
export function checkAbstentionPhraseHeuristic(
  input: AbstentionHeuristicInput,
): AbstentionHeuristicResult {
  const { answerText, retrievedChunks } = input;
  const violations: string[] = [];
  const trimmed = answerText.trim();

  // If the answer explicitly declares insufficient information
  const abstained = COMMON_ABSTENTION_PATTERNS.some((p) => p.test(trimmed));

  // Check numeric-string presence; absence is not proof of hallucination.
  const numericalClaims = extractNumericalEntities(trimmed);
  const chunkTextCombined = Array.from(retrievedChunks.values()).join(' ');
  const numCheck = verifyNumericalStringPresence(trimmed, [chunkTextCombined]);

  if (!abstained && numericalClaims.length > 0 && !numCheck.passed) {
    violations.push('Numeric string was absent from retrieved chunk text');
    return {
      isAnswerable: false,
      hasAbstentionPhrase: false,
      heuristicReason: 'Numeric claim without matching corpus string',
      violations,
    };
  }

  if (abstained) {
    return {
      isAnswerable: false,
      hasAbstentionPhrase: true,
      heuristicReason: 'Refusal phrase detected; correctness requires independent review',
      violations,
    };
  }

  // No refusal phrase was detected; correctness is not established.
  violations.push('No refusal phrase detected on an authored insufficient-evidence case');
  return {
    isAnswerable: false,
    hasAbstentionPhrase: false,
    heuristicReason: 'No refusal phrase detected',
    violations,
  };
}

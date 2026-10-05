/**
 * Fully Supported Answer Rate (FSAR) & Grounded Answerability Evaluation Engine.
 *
 * Implements research-grade evaluation of RAG product question answering,
 * grounded in Stanford ALCE (Attributed Language Evaluation for Citations and Entailment)
 * and frontier AI lab validation standards:
 *
 * 1. Fully Supported Answer Rate (FSAR) on held-out, answerable questions:
 *    - Questions receiving a useful, complete answer where EVERY material factual claim
 *      is directly entailed by cited retrieved passages / all answerable test questions.
 *    - Incomplete answers, unsupported claims, hallucinations, and refusals count as failures.
 *
 * 2. Appropriate Abstention Rate (AAR) on insufficient-evidence questions:
 *    - Measures whether the system correctly declines to guess or state facts when
 *      the corpus lacks evidence, avoiding catastrophic hallucinations.
 *
 * 3. Claim Support Precision:
 *    - Proportion of inline citations that factually entail the associated statement.
 *
 * 4. Factual Citation Recall:
 *    - Proportion of expected reference facts accurately stated and cited in the output.
 */

import {
  chunkSupportsSentence,
  extractInlineCitations,
  extractNumericalEntities,
  splitIntoSentences,
  verifyNumericalEntailment,
} from './alce';

export interface SupportedAnswerEvaluationInput {
  readonly query: string;
  readonly answerText: string;
  readonly retrievedChunks: ReadonlyMap<string, string>;
  readonly referenceFacts: readonly string[];
  readonly numericalEntities?: readonly string[];
}

export interface SupportedAnswerResult {
  readonly isAnswerable: true;
  readonly isUsefulAndComplete: boolean;
  readonly isFullySupported: boolean;
  readonly claimSupportPrecision: number;
  readonly factualRecall: number;
  readonly numericalCheckPassed: boolean;
  readonly missingFacts: readonly string[];
  readonly missingEntities: readonly string[];
  readonly unsupportedClaims: readonly string[];
  readonly violations: readonly string[];
}

export interface AbstentionEvaluationInput {
  readonly query: string;
  readonly answerText: string;
  readonly retrievedChunks: ReadonlyMap<string, string>;
  readonly expectedAbstentionReason?: string;
}

export interface AbstentionResult {
  readonly isAnswerable: false;
  readonly abstainedAppropriately: boolean;
  readonly refusalReason?: string;
  readonly violations: readonly string[];
}

const COMMON_ABSTENTION_PATTERNS = [
  /\b(?:do not have|don't have|no|insufficient)\s+(?:enough\s+)?(?:information|data|evidence|details|reviews|mentions?)\b/i,
  /\b(?:not mentioned|not provided|not available|cannot (?:confirm|verify|find|answer)|unable to find)\b/i,
  /\b(?:not enough (?:information|evidence|details)|corpus does not contain|reviews do not cover)\b/i,
  /\b(?:does not state|cannot determine)\b/i,
];

/**
 * Evaluates whether an answer to an answerable question is useful, complete,
 * and fully supported by its cited passages.
 */
export function evaluateFullySupportedAnswer(
  input: SupportedAnswerEvaluationInput,
): SupportedAnswerResult {
  const { answerText, retrievedChunks, referenceFacts, numericalEntities = [] } = input;
  const violations: string[] = [];
  const trimmed = answerText.trim();

  // 1. Guard against empty answers or failure strings
  if (!trimmed || trimmed.length < 20) {
    violations.push('Answer is empty or trivially short (<20 characters)');
    return {
      isAnswerable: true,
      isUsefulAndComplete: false,
      isFullySupported: false,
      claimSupportPrecision: 0,
      factualRecall: 0,
      numericalCheckPassed: false,
      missingFacts: referenceFacts,
      missingEntities: numericalEntities,
      unsupportedClaims: ['Empty/trivial answer'],
      violations,
    };
  }

  // 2. Guard against inappropriate refusal on answerable questions
  const looksLikeRefusal = COMMON_ABSTENTION_PATTERNS.some((p) => p.test(trimmed));
  if (looksLikeRefusal && referenceFacts.length > 0) {
    violations.push('Model refused to answer an answerable question with available evidence');
  }

  // 3. Completeness & Reference Fact Recall
  const answerLower = trimmed.toLowerCase();
  const missingFacts: string[] = [];
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
      missingFacts.push(fact);
    }
  }

  const factualRecall =
    referenceFacts.length > 0
      ? (referenceFacts.length - missingFacts.length) / referenceFacts.length
      : 1.0;

  // 4. Numerical Entities Check
  const missingEntities: string[] = [];
  for (const expectedEnt of numericalEntities) {
    const rawNumber = expectedEnt.replace(/[^0-9.]/g, '');
    if (!rawNumber) continue;
    const boundaryRegex = new RegExp(`(?:^|[^0-9.])${rawNumber}(?:[^0-9.]|$)`, 'i');
    if (!boundaryRegex.test(trimmed)) {
      missingEntities.push(expectedEnt);
    }
  }
  const numericalCheckPassed = missingEntities.length === 0;
  if (!numericalCheckPassed) {
    violations.push(`Missing expected numerical entities: ${missingEntities.join(', ')}`);
  }

  // 5. Claim Attribution & Citation Entailment
  const sentences = splitIntoSentences(trimmed);
  let totalCitations = 0;
  let supportedCitations = 0;
  const unsupportedClaims: string[] = [];

  for (const sentence of sentences) {
    const citations = extractInlineCitations(sentence);
    const hasNumericalClaim = extractNumericalEntities(sentence).length > 0;
    const isMaterialFact = sentence.length > 25 || hasNumericalClaim;

    if (citations.length === 0) {
      if (isMaterialFact) {
        unsupportedClaims.push(`[Uncited Claim] "${sentence.slice(0, 80)}..."`);
        violations.push(`Material claim lacks citation: "${sentence.slice(0, 80)}..."`);
      }
      continue;
    }

    totalCitations += citations.length;
    let sentenceEntailed = false;

    for (const cid of citations) {
      const chunkText = retrievedChunks.get(cid);
      if (!chunkText) {
        violations.push(`Phantom citation [${cid}] points to missing chunk`);
        continue;
      }

      if (chunkSupportsSentence(sentence, chunkText)) {
        supportedCitations++;
        sentenceEntailed = true;
      }
    }

    if (!sentenceEntailed && isMaterialFact) {
      unsupportedClaims.push(`[Unsupported Cited Claim] "${sentence.slice(0, 80)}..."`);
      violations.push(`Cited claim is not supported by evidence: "${sentence.slice(0, 80)}..."`);
    }
  }

  const claimSupportPrecision = totalCitations > 0 ? supportedCitations / totalCitations : 0;
  const isUsefulAndComplete = factualRecall >= 0.7 && numericalCheckPassed && !looksLikeRefusal;
  const isFullySupported =
    isUsefulAndComplete &&
    unsupportedClaims.length === 0 &&
    claimSupportPrecision >= 0.8 &&
    totalCitations > 0;

  return {
    isAnswerable: true,
    isUsefulAndComplete,
    isFullySupported,
    claimSupportPrecision: Math.round(claimSupportPrecision * 1000) / 1000,
    factualRecall: Math.round(factualRecall * 1000) / 1000,
    numericalCheckPassed,
    missingFacts,
    missingEntities,
    unsupportedClaims,
    violations,
  };
}

/**
 * Evaluates whether an unanswerable / insufficient-evidence question was correctly
 * abstained from rather than generating unsupported claims.
 */
export function evaluateAbstention(input: AbstentionEvaluationInput): AbstentionResult {
  const { answerText, retrievedChunks } = input;
  const violations: string[] = [];
  const trimmed = answerText.trim();

  // If the answer explicitly declares insufficient information
  const abstained = COMMON_ABSTENTION_PATTERNS.some((p) => p.test(trimmed));

  // If the answer made specific numerical claims without evidence
  const numericalClaims = extractNumericalEntities(trimmed);
  const chunkTextCombined = Array.from(retrievedChunks.values()).join(' ');
  const numCheck = verifyNumericalEntailment(trimmed, [chunkTextCombined]);

  if (!abstained && numericalClaims.length > 0 && !numCheck.passed) {
    violations.push('Hallucinated factual claims when corpus lacked evidence');
    return {
      isAnswerable: false,
      abstainedAppropriately: false,
      refusalReason: 'Hallucination: unsupported facts generated',
      violations,
    };
  }

  if (abstained) {
    return {
      isAnswerable: false,
      abstainedAppropriately: true,
      refusalReason: 'Correctly identified lack of evidence and declined to guess',
      violations,
    };
  }

  // Answer neither abstained nor supported
  violations.push('Answer failed to abstain on insufficient evidence question');
  return {
    isAnswerable: false,
    abstainedAppropriately: false,
    refusalReason: 'Failed to abstain',
    violations,
  };
}

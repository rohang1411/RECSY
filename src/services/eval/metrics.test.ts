/**
 * Unit checks for evaluation math and mechanical proxies. These tests do not
 * validate the truth of authored labels or product quality.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDcg,
  computeIdcg,
  computeNdcgAtK,
  computeMrr,
  computePrecisionAtK,
} from './metrics/ranking';
import {
  computeGiniCoefficient,
  computeIntraListDiversity,
  computeShannonEntropy,
} from './metrics/diversity';
import {
  evaluateCitationLexicalProxy,
  extractInlineCitations,
  verifyNumericalStringPresence,
} from './metrics/alce';
import {
  evaluateAnswerHeuristics,
  checkAbstentionPhraseHeuristic,
} from './metrics/supported-answers';
import {
  computeBootstrapConfidenceInterval,
  computeStatisticalSummary,
  computeWilcoxonSignedRank,
} from './metrics/statistics';
import { computeLatencyPercentiles, computeThroughputQps } from './metrics/latency-profiler';
import { evaluatePickConstraints } from './metrics/constraints';
import { checkCandidateConstraints } from './metrics/maut';
import type { PhoneCatalogEntry } from '@/services/recommender/catalog';
import type { RecommenderPersonaFixture } from './types';

describe('self-derived MAUT feasibility', () => {
  it('rejects an unpriced phone under a budget and an unverified foldable', () => {
    const phone: PhoneCatalogEntry = {
      phoneId: 'phone-1',
      slug: 'phone-1',
      brand: 'Example',
      model: 'Fold',
      tagline: null,
      msrpUsd: null,
      imageUrl: null,
      spec: null,
      specEmbedding: null,
      aspectScores: new Map(),
    };
    const fixture: RecommenderPersonaFixture = {
      id: 'policy-1',
      name: 'Impossible request',
      category: 'policy',
      userQuery: 'A foldable under $300',
      requirements: {
        budget_usd: { max: 300 },
        form_factor: 'foldable',
        priorities: [{ aspect: 'value', weight: 1 }],
        use_cases: [],
        must_haves: ['foldable'],
        deal_breakers: [],
        brand_preference: { liked: [], disliked: [] },
      },
      expectNoResults: true,
    };
    const result = checkCandidateConstraints(phone, fixture);
    expect(result.satisfies).toBe(false);
    expect(result.violations).toEqual(
      expect.arrayContaining([
        'Price is missing or invalid under an active budget',
        'Requires foldable form factor',
      ]),
    );
  });
});

describe('Ranking Quality Metrics (NDCG & MRR)', () => {
  it('computes DCG and IDCG with theoretical accuracy', () => {
    // Perfect grades: [3, 2, 1]
    // i=0: (2^3 - 1)/log2(2) = 7 / 1 = 7.0
    // i=1: (2^2 - 1)/log2(3) = 3 / 1.58496 = 1.892789
    // i=2: (2^1 - 1)/log2(4) = 1 / 2 = 0.5
    // Total DCG@3 = 7 + 1.892789 + 0.5 = 9.392789
    const dcg = computeDcg([3, 2, 1], 3);
    expect(dcg).toBeCloseTo(9.393, 2);

    const idcg = computeIdcg([1, 3, 2], 3); // sorted to [3, 2, 1]
    expect(idcg).toBeCloseTo(9.393, 2);
  });

  it('yields NDCG@3 = 1.0 for a perfect ranking', () => {
    const result = computeNdcgAtK([3, 2, 1], [3, 2, 1], 3);
    expect(result.ndcg).toBe(1.0);
    expect(result.k).toBe(3);
  });

  it('penalizes inverted ranking heavily', () => {
    // Inverted grades: [0, 1, 3] vs ideal [3, 2, 1] yields exact NDCG ~ 0.44
    const result = computeNdcgAtK([0, 1, 3], [3, 2, 1], 3);
    expect(result.ndcg).toBeCloseTo(0.44, 2);
  });

  it('handles edge case where all items are irrelevant (IDCG = 0)', () => {
    const result = computeNdcgAtK([0, 0, 0], [0, 0, 0], 3);
    expect(result.ndcg).toBe(1.0); // perfect match for zero relevant items
  });

  it('computes MRR accurately for different ranks', () => {
    expect(computeMrr([3, 0, 0], 2).mrr).toBe(1.0); // rank 1 -> 1/1 = 1.0
    expect(computeMrr([0, 2, 0], 2).mrr).toBe(0.5); // rank 2 -> 1/2 = 0.5
    expect(computeMrr([0, 1, 2], 2).mrr).toBe(0.333); // rank 3 -> 1/3 = 0.333
    expect(computeMrr([0, 1, 0], 2).mrr).toBe(0.0); // no item >= 2
  });

  it('computes Precision@K correctly', () => {
    expect(computePrecisionAtK([3, 2, 0, 1], 3, 2)).toBe(0.667); // 2 out of 3
    expect(computePrecisionAtK([3, 3, 3], 3, 2)).toBe(1.0);
  });
});

describe('Diversity & Beyond-Accuracy Metrics', () => {
  it('computes Intra-List Diversity (ILD) using cosine distance', () => {
    // Two orthogonal vectors (distance = 1.0)
    const vec1 = [1, 0, 0];
    const vec2 = [0, 1, 0];
    const ildOrthogonal = computeIntraListDiversity([vec1, vec2], 2);
    expect(ildOrthogonal).toBe(1.0);

    // Two identical vectors (distance = 0.0)
    const ildIdentical = computeIntraListDiversity([vec1, vec1], 2);
    expect(ildIdentical).toBe(0.0);
  });

  it('computes Gini coefficient correctly across distributions', () => {
    // Completely equal distribution -> Gini = 0
    expect(computeGiniCoefficient([10, 10, 10, 10])).toBe(0.0);

    // Extreme inequality -> Gini close to 1
    const extreme = [0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
    expect(computeGiniCoefficient(extreme)).toBeGreaterThan(0.75);
  });

  it('computes Shannon entropy of brand distribution', () => {
    // Equal probability across 2 brands -> entropy = -2 * (0.5 * log2(0.5)) = 1.0
    const entropy = computeShannonEntropy({ Apple: 50, Samsung: 50 });
    expect(entropy).toBe(1.0);
  });
});

describe('mechanical citation and lexical-overlap checks', () => {
  it('extracts inline UUID citation tags', () => {
    const text =
      'Battery is 5000mAh [c:11111111-1111-1111-1111-111111111111] and charges fast [c:22222222-2222-2222-2222-222222222222].';
    const citations = extractInlineCitations(text);
    expect(citations).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
  });

  it('checks numeric-string presence in cited chunks', () => {
    const sentence = 'The phone features 45W fast charging and a 5000 mAh battery.';
    const chunkWithBoth = ['The device supports 45W wired charging with its 5000 mAh cell.'];
    const chunkMissing45W = ['The device has a 5000 mAh cell but charges at standard speed.'];

    expect(verifyNumericalStringPresence(sentence, chunkWithBoth).passed).toBe(true);
    const missing = verifyNumericalStringPresence(sentence, chunkMissing45W);
    expect(missing.passed).toBe(false);
    expect(missing.missingEntities).toContain('45w');
  });

  it('evaluates citation precision and detects phantom tags', () => {
    const c1 = '11111111-1111-1111-1111-111111111111';
    const cPhantom = '99999999-9999-9999-9999-999999999999';

    const chunkMap = new Map<string, string>();
    chunkMap.set(c1, 'The battery capacity is 5000 mAh with 25W charging speed.');

    const text = `The phone has a 5000 mAh battery [c:${c1}]. It also has 100x zoom [c:${cPhantom}].`;
    const result = evaluateCitationLexicalProxy(text, chunkMap);

    expect(result.totalCitations).toBe(2);
    expect(result.citePrec).toBe(0.5); // 1 valid, 1 phantom
    expect(result.phantomRate).toBe(0.5);
  });
});

describe('Scientific Statistics & Uncertainty Analysis', () => {
  it('computes 95% Bootstrap Confidence Intervals', () => {
    const values = [0.85, 0.88, 0.9, 0.92, 0.89, 0.91, 0.87, 0.93];
    const summary = computeStatisticalSummary(values);

    expect(summary.mean).toBeCloseTo(0.894, 2);
    expect(summary.ci95[0]).toBeLessThanOrEqual(summary.mean);
    expect(summary.ci95[1]).toBeGreaterThanOrEqual(summary.mean);
  });

  it('computes bootstrap confidence intervals directly', () => {
    const ci = computeBootstrapConfidenceInterval([0.85, 0.88, 0.9, 0.92], 200, 0.05);
    expect(ci[0]).toBeLessThanOrEqual(ci[1]);
  });

  it('computes Wilcoxon Signed-Rank test for paired ablation significance', () => {
    const baseline = [0.7, 0.72, 0.68, 0.71, 0.69, 0.73, 0.7, 0.68];
    const improved = [0.88, 0.91, 0.86, 0.89, 0.92, 0.9, 0.87, 0.89];

    const result = computeWilcoxonSignedRank(improved, baseline);
    expect(result.isSignificant).toBe(true);
    expect(result.pValue).toBeLessThan(0.05);
  });
});

describe('Latency Profiler & Saturation Analysis', () => {
  it('computes p50, p90, p95, p99 latencies correctly', () => {
    // 100 values from 1 to 100
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1);
    const p = computeLatencyPercentiles(latencies);

    expect(p.p50).toBe(50.5);
    expect(p.p90).toBe(90.1);
    expect(p.p95).toBe(95.05);
    expect(p.p99).toBe(99.01);
  });

  it('computes throughput in QPS', () => {
    expect(computeThroughputQps(100, 2000)).toBe(50.0); // 100 requests in 2 seconds = 50 QPS
  });
});

describe('Constraint Satisfaction Policy Gates', () => {
  const dummyFixture: RecommenderPersonaFixture = {
    id: 'test-1',
    name: 'Test',
    category: 'test',
    userQuery: 'test query',
    requirements: {
      budget_usd: { max: 700 },
      priorities: [{ aspect: 'camera', weight: 1.0 }],
      use_cases: [],
      must_haves: ['iOS'],
      deal_breakers: ['curved screen'],
      brand_preference: { liked: ['Apple'], disliked: ['Xiaomi'] },
    },
  };

  it('fails invalid and below-minimum prices without certifying unknown feature coverage', () => {
    const fixture = {
      ...dummyFixture,
      requirements: {
        ...dummyFixture.requirements,
        budget_usd: { min: 500 },
        must_haves: ['iOS', 'NFC'],
      },
    };
    const pick = {
      phoneId: 'p',
      slug: 'phone',
      brand: 'Apple',
      model: 'Phone',
      score: 1,
      summary: 'Good phone',
      msrpUsd: 'NaN',
      localPrice: null,
      localCurrency: null,
      imageUrl: null,
    };
    const invalid = evaluatePickConstraints([pick], fixture);
    expect(invalid.budgetSatisfied).toBe(false);
    expect(invalid.violations.join(' ')).toContain('minimum $500');
    expect(invalid.violations.join(' ')).not.toContain('undefined');
    expect(evaluatePickConstraints([{ ...pick, msrpUsd: '499' }], fixture).budgetSatisfied).toBe(
      false,
    );
    const inBudget = evaluatePickConstraints([{ ...pick, msrpUsd: '600' }], fixture);
    expect(inBudget.budgetSatisfied).toBe(true);
    expect(inBudget.allSatisfied).toBe(false);
    expect(inBudget.violations.join(' ')).toContain('Unverified Constraint Coverage');
  });

  it('detects budget and platform violations', () => {
    const picks = [
      {
        phoneId: 'p1',
        slug: 'expensive-android',
        brand: 'Samsung',
        model: 'Galaxy S24 Ultra',
        score: 9.0,
        summary: 'Flagship phone with curved screen glass',
        msrpUsd: '1299.00',
        localPrice: null,
        localCurrency: null,
        imageUrl: null,
      },
    ];

    const result = evaluatePickConstraints(picks, dummyFixture);
    expect(result.allSatisfied).toBe(false);
    expect(result.budgetSatisfied).toBe(false); // $1299 > $700
    expect(result.platformSatisfied).toBe(false); // Not Apple/iOS
    expect(result.dealbreakerAvoided).toBe(false); // Contains "curved screen"
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
  });

  it('[Counterexample 5] rejects empty recommendations as constraint failure', () => {
    const result = evaluatePickConstraints([], dummyFixture);
    expect(result.allSatisfied).toBe(false);
    expect(result.budgetSatisfied).toBe(false);
    expect(result.dealbreakerAvoided).toBe(false);
    expect(result.platformSatisfied).toBe(false);
    expect(result.violations).toContainEqual(
      expect.stringContaining('[Empty Recommendation Failure]'),
    );
  });

  it('rejects unpriced phones when a strict maximum budget is active', () => {
    const picks = [
      {
        phoneId: 'p2',
        slug: 'unpriced-phone',
        brand: 'Apple',
        model: 'iPhone Special',
        score: 9.0,
        summary: 'Special edition',
        msrpUsd: null,
        localPrice: null,
        localCurrency: null,
        imageUrl: null,
      },
    ];
    const result = evaluatePickConstraints(picks, dummyFixture);
    expect(result.budgetSatisfied).toBe(false);
    expect(result.allSatisfied).toBe(false);
    expect(result.violations).toContainEqual(
      expect.stringContaining('[Budget Verification Failure]'),
    );
  });
});

describe('ChatGPT Counterexamples & Rigorous Evaluation Audits', () => {
  it('[Counterexample 1] fails citation precision when claim is unrelated to valid chunk ID', () => {
    const cid = 'chunk-valid-1';
    const chunkMap = new Map<string, string>();
    chunkMap.set(cid, 'The phone features a 6.7-inch OLED display with 120Hz refresh rate.');

    // Claim is completely unrelated to screen specs (claims water resistance)
    const text = `The phone has 50m water resistance and titanium frame [c:${cid}].`;
    const result = evaluateCitationLexicalProxy(text, chunkMap);

    // Previously this gave citePrec = 1.0 merely because cid existed in chunkMap.
    // Now chunkPassesLexicalProxy checks content overlap, so precision is 0.0.
    expect(result.citePrec).toBe(0.0);
    expect(result.sentenceAttributions[0]!.passesLexicalProxy).toBe(false);
  });

  it('[Counterexample 2] returns citePrec = 0.0 when answer provides zero citations', () => {
    const chunkMap = new Map<string, string>();
    chunkMap.set('c1', 'The phone has a 5000 mAh battery.');

    const text = 'The phone has exceptional battery life and fast charging.';
    const result = evaluateCitationLexicalProxy(text, chunkMap);

    // Previously an uncited answer gave citePrec = 1.0 (vacuous truth).
    // Now uncited answers correctly receive 0.0.
    expect(result.citePrec).toBe(0.0);
    expect(result.totalCitations).toBe(0);
  });

  it('[Counterexample 3] rejects $99 when evidence only contains $999', () => {
    const sentence = 'The phone starts at $99 in the United States.';
    const evidence = ['The flagship device retails at $999 for the 256GB model.'];

    // Previously substring matching allowed '99' to pass inside '999'.
    // Now boundary-aware matching catches the factual discrepancy.
    const check = verifyNumericalStringPresence(sentence, evidence);
    expect(check.passed).toBe(false);
    expect(check.missingEntities).toContain('$99');
  });
});

describe('answer-text and refusal-phrase heuristics', () => {
  it('requires a literal decimal point in an expected numeric string', () => {
    const result = evaluateAnswerHeuristics({
      query: 'What is the measured value?',
      answerText: 'The measurement is 99x9 units, as described in the source passage [c:chunk-1].',
      retrievedChunks: new Map([['chunk-1', 'The measurement is 99x9 units.']]),
      referenceFacts: ['99.9 units'],
      numericalEntities: ['99.9'],
    });
    expect(result.numericalCheckPassed).toBe(false);
    expect(result.missingEntities).toContain('99.9');
  });

  it('passes the encoded lexical and numeric checks on a simple matching example', () => {
    const cid = 'chunk-100';
    const chunkMap = new Map<string, string>();
    chunkMap.set(
      cid,
      'The OnePlus 12 features a 5400 mAh battery with 100W SuperVOOC wired fast charging.',
    );

    const answer =
      'The OnePlus 12 has a large 5400 mAh battery with 100W wired fast charging [c:' + cid + '].';
    const result = evaluateAnswerHeuristics({
      query: 'What is the battery and charging speed of the OnePlus 12?',
      answerText: answer,
      retrievedChunks: chunkMap,
      referenceFacts: ['5400 mAh battery', '100W fast charging'],
      numericalEntities: ['5400', '100w'],
    });

    expect(result.passesHeuristicChecks).toBe(true);
    expect(result.appearsCompleteByKeywords).toBe(true);
    expect(result.lexicalCitationSupport).toBe(1.0);
    expect(result.lexicalReferenceCoverage).toBe(1.0);
  });

  it('rejects a material sentence without an inline citation', () => {
    const cid = 'chunk-100';
    const chunkMap = new Map<string, string>();
    chunkMap.set(cid, 'The OnePlus 12 features a 5400 mAh battery.');

    const answer =
      'The OnePlus 12 features a 5400 mAh battery [c:' +
      cid +
      ']. It also charges at 100W in just 26 minutes.';
    const result = evaluateAnswerHeuristics({
      query: 'What is the battery and charging speed of the OnePlus 12?',
      answerText: answer,
      retrievedChunks: chunkMap,
      referenceFacts: ['5400 mAh battery', '100W fast charging'],
      numericalEntities: ['5400', '100w'],
    });

    expect(result.passesHeuristicChecks).toBe(false);
    expect(result.unmatchedSentences.length).toBeGreaterThan(0);
  });

  it('detects an explicit insufficient-evidence phrase', () => {
    const chunkMap = new Map<string, string>();
    chunkMap.set('c1', 'The phone is IP68 water resistant up to 1.5 meters for 30 minutes.');

    // A refusal phrase is detected; this does not prove the answer is correct.
    const abstainedAnswer =
      'I do not have enough information to confirm scuba diving at 40 meters. The reviews only note IP68 certification up to 1.5 meters.';
    const passResult = checkAbstentionPhraseHeuristic({
      query: 'Can it survive scuba diving at 40 meters?',
      answerText: abstainedAnswer,
      retrievedChunks: chunkMap,
    });
    expect(passResult.hasAbstentionPhrase).toBe(true);

    // An unsupported numeric claim has no refusal phrase.
    const hallucinatedAnswer =
      'Yes, the phone handles deep scuba diving down to 40 meters without issues.';
    const failResult = checkAbstentionPhraseHeuristic({
      query: 'Can it survive scuba diving at 40 meters?',
      answerText: hallucinatedAnswer,
      retrievedChunks: chunkMap,
    });
    expect(failResult.hasAbstentionPhrase).toBe(false);
  });
});

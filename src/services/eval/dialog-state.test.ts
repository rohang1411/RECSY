/**
 * Vitest Verification Suite for Multi-Turn Dialog State Tracking (DST) & CRS Engine.
 *
 * Verifies:
 *  1. Joint Goal Accuracy (JGA) across slot constraints (budget, brands, must-haves, form-factors)
 *  2. Constraint Mutation Responsiveness (0-turn latency)
 *  3. Constraint Retention Rate (CRR / Anti-Forgetting) across conversational history
 *  4. Refine Scope Verification (candidate subsets vs full catalog)
 *  5. Hard Constraint Satisfaction (CSR) on recommendation picks
 */
import { describe, expect, it } from 'vitest';
import { evaluateTurnDialogState } from './metrics/dialog-state';
import type { PhoneSpec } from '@/features/phones/schema';
import type { PhoneCatalogEntry } from '@/services/recommender/catalog';
import type {
  RecommendApiPick,
  RecommendPipelineResult,
} from '@/services/recommender/run-recommendation';
import type { UserRequirements } from '@/services/recommender/requirements-schema';
import type { TrajectoryTurn, TurnEvaluationResult } from './types';

const MOCK_CATALOG: PhoneCatalogEntry[] = [
  {
    phoneId: 'phone-1',
    slug: 'pixel-8a',
    brand: 'Google',
    model: 'Pixel 8a',
    tagline: 'Best compact phone',
    imageUrl: null,
    specEmbedding: null,
    msrpUsd: '499',
    aspectScores: new Map([
      ['performance', 8.5],
      ['camera', 9.0],
      ['battery', 8.2],
      ['display', 8.5],
      ['software', 9.5],
      ['build', 8.0],
      ['value', 9.0],
    ]),
    spec: {
      screenSizeInches: 6.1,
      ramGb: 8,
      storageGb: 128,
      batteryMah: 4492,
      chargingWattage: 18,
      os: 'Android',
    } as unknown as PhoneSpec,
  },
  {
    phoneId: 'phone-2',
    slug: 'galaxy-s24',
    brand: 'Samsung',
    model: 'Galaxy S24',
    tagline: 'Flagship compact',
    imageUrl: null,
    specEmbedding: null,
    msrpUsd: '799',
    aspectScores: new Map([
      ['performance', 9.2],
      ['camera', 8.8],
      ['battery', 8.0],
      ['display', 9.2],
      ['software', 8.5],
      ['build', 9.0],
      ['value', 7.5],
    ]),
    spec: {
      screenSizeInches: 6.2,
      ramGb: 8,
      storageGb: 256,
      batteryMah: 4000,
      chargingWattage: 25,
      os: 'Android',
    } as unknown as PhoneSpec,
  },
  {
    phoneId: 'phone-3',
    slug: 'iphone-15',
    brand: 'Apple',
    model: 'iPhone 15',
    tagline: 'Base Apple flagship',
    imageUrl: null,
    specEmbedding: null,
    msrpUsd: '799',
    aspectScores: new Map([
      ['performance', 9.4],
      ['camera', 9.1],
      ['battery', 8.4],
      ['display', 8.8],
      ['software', 9.2],
      ['build', 9.3],
      ['value', 7.8],
    ]),
    spec: {
      screenSizeInches: 6.1,
      ramGb: 6,
      storageGb: 128,
      batteryMah: 3349,
      chargingWattage: 20,
      os: 'iOS',
    } as unknown as PhoneSpec,
  },
];

function createMockReq(overrides: Partial<UserRequirements> = {}): UserRequirements {
  return {
    confidence: 0.95,
    clarifying_question: undefined,
    budget_usd: null,
    priorities: [],
    must_haves: [],
    deal_breakers: [],
    use_cases: [],
    brand_preference: { liked: [], disliked: [] },
    ...overrides,
  };
}

function createMockPick(overrides: Partial<RecommendApiPick> = {}): RecommendApiPick {
  return {
    phoneId: 'phone-1',
    slug: 'pixel-8a',
    brand: 'Google',
    model: 'Pixel 8a',
    score: 0.9,
    summary: 'Best compact phone for the budget',
    msrpUsd: '499',
    localPrice: null,
    localCurrency: null,
    imageUrl: null,
    ...overrides,
  };
}

function createMockPipelineResult(
  overrides: Partial<{
    requirements: UserRequirements;
    picks: readonly RecommendApiPick[];
    relaxed: readonly string[];
    refined: boolean;
    scoresTied: boolean;
    scorecardMissing: boolean;
    topAspects: readonly string[];
  }> = {},
): RecommendPipelineResult {
  return {
    kind: 'results',
    requirements: overrides.requirements ?? createMockReq(),
    picks: overrides.picks ?? [],
    relaxed: overrides.relaxed ?? [],
    refined: overrides.refined ?? false,
    scoresTied: overrides.scoresTied ?? false,
    scorecardMissing: overrides.scorecardMissing ?? false,
    topAspects: overrides.topAspects ?? [],
  };
}

describe('Multi-Turn Dialog State Tracking (DST) Engine', () => {
  it('computes JGA = 1.0 when all expected slot constraints match extracted state', () => {
    const turn: TrajectoryTurn = {
      turnIndex: 1,
      userMessage: 'Looking for a compact Android under $600 with good camera, no Samsung',
      expectedSlots: {
        budgetMaxUsd: 600,
        dislikedBrands: ['Samsung'],
        mustHaves: ['compact', 'android'],
        formFactor: 'compact',
      },
    };

    const pipelineResult = createMockPipelineResult({
      requirements: createMockReq({
        budget_usd: { max: 600 },
        brand_preference: { liked: [], disliked: ['Samsung'] },
        must_haves: ['compact', 'android'],
        form_factor: { screen_size_range_in: [5.8, 6.2] },
      }),
      picks: [
        createMockPick({
          phoneId: 'phone-1',
          slug: 'pixel-8a',
          brand: 'Google',
          model: 'Pixel 8a',
          score: 0.92,
          msrpUsd: '499',
        }),
      ],
    });

    const evalResult = evaluateTurnDialogState({
      turn,
      result: pipelineResult,
      priorTurnResults: [],
      catalog: MOCK_CATALOG,
      latencyMs: 150,
    });

    expect(evalResult.jgaScore).toBe(1.0);
    expect(evalResult.hardConstraintSatisfied).toBe(true);
    expect(evalResult.mutationResponsiveness).toBe(true);
    expect(evalResult.constraintViolations).toHaveLength(0);
  });

  it('detects slot divergence and reflects partial JGA score', () => {
    const turn: TrajectoryTurn = {
      turnIndex: 1,
      userMessage: 'Under $500, no Apple',
      expectedSlots: {
        budgetMaxUsd: 500,
        dislikedBrands: ['Apple'],
      },
    };

    // Simulated LLM state tracking failure: captured budget but missed disliked brand
    const pipelineResult = createMockPipelineResult({
      requirements: createMockReq({
        budget_usd: { max: 500 },
        brand_preference: { liked: [], disliked: [] },
      }),
      picks: [],
    });

    const evalResult = evaluateTurnDialogState({
      turn,
      result: pipelineResult,
      priorTurnResults: [],
      catalog: MOCK_CATALOG,
      latencyMs: 120,
    });

    // 1 of 2 slots passed -> 0.5 JGA
    expect(evalResult.jgaScore).toBe(0.5);
    expect(
      evalResult.constraintViolations.some((v) => v.includes('Disliked brands mismatch')),
    ).toBe(true);
  });

  it('flags hard constraint violations when candidate pick exceeds active budget', () => {
    const turn: TrajectoryTurn = {
      turnIndex: 2,
      userMessage: 'Tighten budget to strictly $600 max',
      expectedSlots: { budgetMaxUsd: 600 },
    };

    const pipelineResult = createMockPipelineResult({
      requirements: createMockReq({ budget_usd: { max: 600 } }),
      picks: [
        createMockPick({
          phoneId: 'phone-2',
          slug: 'galaxy-s24',
          brand: 'Samsung',
          model: 'Galaxy S24',
          score: 0.88,
          msrpUsd: '799', // Violates $600 max!
        }),
      ],
    });

    const evalResult = evaluateTurnDialogState({
      turn,
      result: pipelineResult,
      priorTurnResults: [],
      catalog: MOCK_CATALOG,
      latencyMs: 180,
    });

    expect(evalResult.hardConstraintSatisfied).toBe(false);
    expect(evalResult.mutationResponsiveness).toBe(false);
    expect(evalResult.constraintViolations.some((v) => v.includes('violates budget max'))).toBe(
      true,
    );
  });

  it('measures Constraint Retention Rate (CRR) and flags context decay', () => {
    const priorTurn1: TurnEvaluationResult = {
      turnIndex: 1,
      userMessage: 'Under $600',
      kind: 'results',
      kindMatched: true,
      latencyMs: 100,
      jgaScore: 1.0,
      constraintViolations: [],
      hardConstraintSatisfied: true,
      mutationResponsiveness: true,
      retentionScore: 1.0,
      refineIntentMatched: true,
      picks: [],
      activeRequirements: createMockReq({
        budget_usd: { max: 600 },
        brand_preference: { liked: [], disliked: ['Apple'] },
        must_haves: ['android'],
      }),
    };

    const turn2: TrajectoryTurn = {
      turnIndex: 2,
      userMessage: 'I also need 256GB storage and wireless charging',
      mustPreservePriorSlots: ['budget', 'disliked_brands', 'platform'],
    };

    // Simulated context decay: forgotten budget and forgotten platform!
    const decayingResult = createMockPipelineResult({
      requirements: createMockReq({
        must_haves: ['256gb', 'wireless charging'], // forgot android!
        brand_preference: { liked: [], disliked: ['Apple'] }, // retained Apple
        // budget forgotten!
      }),
      picks: [],
    });

    const evalResult = evaluateTurnDialogState({
      turn: turn2,
      result: decayingResult,
      priorTurnResults: [priorTurn1],
      catalog: MOCK_CATALOG,
      latencyMs: 140,
    });

    // 1 retained (disliked_brands), 2 forgotten (budget, platform) -> 1/3 = ~0.333
    expect(evalResult.retentionScore).toBeCloseTo(0.333, 2);
    expect(
      evalResult.constraintViolations.some((v) =>
        v.includes('Constraint Decay: budget $600 was forgotten'),
      ),
    ).toBe(true);
    expect(
      evalResult.constraintViolations.some((v) => v.includes('Constraint Decay: platform')),
    ).toBe(true);
  });

  it('validates refine intent scope (only subset of prior picks allowed)', () => {
    const priorPickSet = [
      {
        phoneId: 'phone-1',
        slug: 'pixel-8a',
        brand: 'Google',
        model: 'Pixel 8a',
        score: 0.9,
        msrpUsd: '499',
      },
      {
        phoneId: 'phone-2',
        slug: 'galaxy-s24',
        brand: 'Samsung',
        model: 'Galaxy S24',
        score: 0.85,
        msrpUsd: '799',
      },
    ];

    const priorTurn: TurnEvaluationResult = {
      turnIndex: 1,
      userMessage: 'Show me compact phones',
      kind: 'results',
      kindMatched: true,
      latencyMs: 100,
      jgaScore: 1.0,
      constraintViolations: [],
      hardConstraintSatisfied: true,
      mutationResponsiveness: true,
      retentionScore: 1.0,
      refineIntentMatched: true,
      picks: priorPickSet,
      activeRequirements: createMockReq(),
    };

    const turn2: TrajectoryTurn = {
      turnIndex: 2,
      userMessage: 'Between these two, which one has cleaner software?',
      expectRefineIntent: true,
    };

    // Valid refine: picks phone-1 (subset of prior picks)
    const validRefine = createMockPipelineResult({
      refined: true,
      requirements: createMockReq(),
      picks: [
        createMockPick({
          phoneId: 'phone-1',
          slug: 'pixel-8a',
          brand: 'Google',
          model: 'Pixel 8a',
          score: 0.95,
          msrpUsd: '499',
        }),
      ],
    });

    const evalResult = evaluateTurnDialogState({
      turn: turn2,
      result: validRefine,
      priorTurnResults: [priorTurn],
      catalog: MOCK_CATALOG,
      latencyMs: 110,
    });

    expect(evalResult.refineIntentMatched).toBe(true);

    // Invalid refine: returned phone-3 which was NOT in prior picks
    const invalidRefine = createMockPipelineResult({
      refined: true,
      requirements: createMockReq(),
      picks: [
        createMockPick({
          phoneId: 'phone-3',
          slug: 'iphone-15',
          brand: 'Apple',
          model: 'iPhone 15',
          score: 0.95,
          msrpUsd: '799',
        }),
      ],
    });

    const evalResultInvalid = evaluateTurnDialogState({
      turn: turn2,
      result: invalidRefine,
      priorTurnResults: [priorTurn],
      catalog: MOCK_CATALOG,
      latencyMs: 110,
    });

    expect(evalResultInvalid.refineIntentMatched).toBe(false);
    expect(
      evalResultInvalid.constraintViolations.some((v) => v.includes('Refine scope violation')),
    ).toBe(true);
  });
});

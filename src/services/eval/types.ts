/**
 * Core contracts for RECSY component evaluation. Some persisted tier and
 * metric field names are historical; see the operator guide before interpreting them.
 */
import type { AspectName } from '@/lib/constants';
import type { UserRequirements } from '@/services/recommender/requirements-schema';

export type BenchmarkTier =
  | 'L1_DATA_PLANE'
  | 'L2_WARM_API'
  | 'L3_MACRO_LLM'
  | 'OFFLINE_RECSYS'
  | 'RAG_ALCE'
  | 'ABLATION'
  | 'MULTI_TURN_CRS';

export type BenchmarkStatus = 'pending' | 'running' | 'success' | 'failed' | 'unverified';
export type TestCaseStatus = 'pass' | 'fail' | 'warn';
export type TestCaseCategory = 'recsys' | 'rag' | 'stress' | 'ablation' | 'multi-turn';

// ---------------------------------------------------------------------------
// Golden Benchmark Fixture Contracts
// ---------------------------------------------------------------------------

export interface RecommenderPersonaFixture {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly userQuery: string;
  readonly requirements: {
    readonly budget_usd?: { readonly min?: number; readonly max?: number };
    readonly form_factor?: 'standard' | 'foldable' | 'compact';
    readonly priorities: readonly { readonly aspect: AspectName; readonly weight: number }[];
    readonly use_cases: readonly string[];
    readonly must_haves: readonly string[];
    readonly deal_breakers: readonly string[];
    readonly brand_preference: {
      readonly liked: readonly string[];
      readonly disliked: readonly string[];
    };
  };
  readonly expectNoResults?: boolean;
}

export interface AttributedQaFixture {
  readonly id: string;
  readonly phoneSlug: string;
  readonly category: string;
  readonly query: string;
  readonly referenceFacts: readonly string[];
  readonly numericalEntities?: readonly string[];
}

export interface TrajectoryTurn {
  readonly turnIndex: number;
  readonly userMessage: string;
  readonly expectedKind?: 'results' | 'clarify';
  readonly expectedSlots?: {
    readonly budgetMaxUsd?: number | null;
    readonly dislikedBrands?: readonly string[];
    readonly likedBrands?: readonly string[];
    readonly mustHaves?: readonly string[];
    readonly dealBreakers?: readonly string[];
    readonly formFactor?: 'compact' | 'foldable' | 'standard';
    readonly topAspect?: AspectName;
  };
  readonly forbiddenBrands?: readonly string[];
  readonly forbiddenSlugs?: readonly string[];
  readonly expectRefineIntent?: boolean;
  readonly isReset?: boolean;
  readonly mustPreservePriorSlots?: readonly string[];
}

export interface MultiTurnTrajectoryFixture {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly turns: readonly TrajectoryTurn[];
}

export interface GoldenBenchmarkDataset {
  readonly version: string;
  readonly description: string;
  readonly recommenderPersonas: readonly RecommenderPersonaFixture[];
  readonly attributedQaQueries: readonly AttributedQaFixture[];
  readonly multiTurnTrajectories?: readonly MultiTurnTrajectoryFixture[];
}

// ---------------------------------------------------------------------------
// Evaluation Metric Outputs
// ---------------------------------------------------------------------------

export interface NdcgResult {
  readonly ndcg: number;
  readonly dcg: number;
  readonly idcg: number;
  readonly k: number;
  readonly actualGrades: readonly number[];
  readonly idealGrades: readonly number[];
}

export interface MrrResult {
  readonly mrr: number;
  readonly firstRelevantRank: number | null;
}

export interface ConstraintSatisfactionResult {
  readonly budgetSatisfied: boolean;
  readonly dealbreakerAvoided: boolean;
  readonly platformSatisfied: boolean;
  readonly allSatisfied: boolean;
  readonly violations: readonly string[];
}

export interface DiversityMetrics {
  readonly ild: number;
  readonly catalogCoverage: number;
  readonly giniCoefficient: number;
  readonly brandEntropy: number;
  readonly uniquePhonesRecommended: number;
  readonly totalCatalogSize: number;
}

export interface SentenceAttribution {
  readonly sentence: string;
  readonly citations: readonly string[];
  readonly hasValidChunkRefs: boolean;
  readonly passesLexicalProxy: boolean;
  readonly numericalCheckPassed: boolean;
  readonly missingEntities: readonly string[];
}

export interface CitationLexicalProxyResult {
  readonly citePrec: number;
  readonly citeRec: number;
  readonly phantomRate: number;
  readonly totalSentences: number;
  readonly citedSentences: number;
  readonly totalCitations: number;
  readonly sentenceAttributions: readonly SentenceAttribution[];
}

export interface StatisticalSummary {
  readonly mean: number;
  readonly stdDev: number;
  readonly stdError: number;
  readonly ci95: readonly [number, number];
  readonly median: number;
  readonly sampleSize: number;
}

export interface LatencyPercentiles {
  readonly min: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly jitter: number;
}

export interface LoadStressResult {
  readonly targetComponent: 'data-plane-retrieval' | 'data-plane-recsys';
  readonly catalogCount: number;
  readonly targetChunkCount: number;
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly errorRate: number;
  readonly concurrencyVus: number;
  readonly durationMs: number;
  readonly qps: number;
  readonly goodputQps: number;
  readonly stageP95Ms: Record<string, number>;
  readonly latency: LatencyPercentiles;
  readonly eventLoopLagMs: number;
  readonly errorCounts: Record<string, number>;
  readonly errorSamples: readonly string[];
}

// ---------------------------------------------------------------------------
// Run & Result Aggregations
// ---------------------------------------------------------------------------

export interface TurnEvaluationResult {
  readonly turnIndex: number;
  readonly userMessage: string;
  readonly kind: 'results' | 'clarify';
  readonly kindMatched: boolean;
  readonly latencyMs: number;
  readonly jgaScore: number;
  readonly slotAccuracy?: number;
  readonly isRetentionTurn?: boolean;
  readonly retentionChecksTotal?: number;
  readonly retentionChecksPassed?: number;
  readonly constraintViolations: readonly string[];
  readonly hardConstraintSatisfied: boolean;
  readonly mutationResponsiveness: boolean;
  readonly mutationEligible?: boolean;
  readonly retentionScore: number;
  readonly refineIntentMatched: boolean;
  readonly resetCleanliness?: number;
  readonly picks: readonly {
    readonly phoneId: string;
    readonly slug: string;
    readonly brand: string;
    readonly model: string;
    readonly score: number;
    readonly msrpUsd: string | null;
  }[];
  readonly activeRequirements: UserRequirements;
  readonly ndcg3?: number;
}

export interface TrajectoryEvaluationResult {
  readonly trajectoryId: string;
  readonly name: string;
  readonly category: string;
  readonly status: TestCaseStatus;
  readonly turnResults: readonly TurnEvaluationResult[];
  readonly overallJga: number;
  readonly overallSlotAccuracy?: number;
  readonly overallRetentionRate: number | null;
  readonly overallMutationResponsiveness: number | null;
  readonly refineIntentAccuracy: number | null;
  readonly refineIntentF1: number | null;
  readonly resetCleanliness: number | null;
  readonly tokenUsage?: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly isMeasured?: boolean;
  };
  readonly durationMs: number;
}

export interface BenchmarkRunMetricsSummary {
  readonly providerTransportBudget?: Readonly<Record<string, unknown>>;
  readonly executionError?: string;
  readonly ndcg3?: StatisticalSummary;
  readonly ndcg5?: StatisticalSummary;
  readonly mrr?: number;
  readonly ild3?: StatisticalSummary;
  readonly ildCoverageCases?: number;
  readonly catalogCoverage?: number;
  readonly giniCoefficient?: number;
  readonly budgetCsr?: number;
  readonly dealbreakerCsr?: number;
  readonly constraintPolicyCases?: number;
  readonly noResultPolicyCases?: number;
  readonly noResultPolicyPassed?: number;
  readonly citePrec?: StatisticalSummary;
  readonly citeRec?: StatisticalSummary;
  readonly phantomRate?: number;
  readonly latencyP50?: number;
  readonly latencyP90?: number;
  readonly latencyP95?: number;
  readonly latencyP99?: number;
  readonly peakQps?: number;
  readonly goodputQps?: number;
  readonly stageP95Ms?: Record<string, number>;
  readonly totalTests?: number;
  readonly passedTests?: number;
  readonly failedTests?: number;
  // Multi-Turn Conversational Recommender (CRS) Metrics
  readonly jointGoalAccuracy?: StatisticalSummary;
  readonly slotAccuracy?: StatisticalSummary;
  readonly constraintRetentionRate?: StatisticalSummary;
  readonly mutationResponsiveness?: number;
  readonly refineIntentF1?: number;
  readonly resetCleanliness?: number;
  readonly multiTurnCsr?: number;
  readonly meanTurnNdcg3?: StatisticalSummary;
  readonly tokenUsage?: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly totalTokens: number;
  };
  readonly generationProviderCalls?: number;
  readonly generationCacheHits?: number;
  readonly generationUsageCoveredCalls?: number;
  readonly retrievalObservedCases?: number;
  readonly ftsZeroCases?: number;
  readonly vectorZeroCases?: number;
  // Legacy optional fields retained for stored-run compatibility; not established quality scores.
  readonly fullySupportedAnswerRate?: StatisticalSummary;
  readonly appropriateAbstentionRate?: number;
  readonly claimSupportPrecision?: StatisticalSummary;
  readonly factualCitationRecall?: StatisticalSummary;
}

export interface BenchmarkResultItem {
  readonly id: string;
  readonly runId: string;
  readonly testCaseId: string;
  readonly category: TestCaseCategory;
  readonly inputQuery: string;
  readonly status: TestCaseStatus;
  readonly latencyMs: number;
  readonly scores: Record<string, number | null>;
  readonly tracePayload?: {
    readonly expectedNoResults?: boolean;
    readonly feasibleCount?: number;
    readonly actualPicks?: readonly {
      readonly slug: string;
      readonly score: number;
      readonly utilityGrade: number;
      readonly priceUsd: number | null;
    }[];
    readonly idealPicks?: readonly {
      readonly slug: string;
      readonly utilityGrade: number;
      readonly utilityScore: number;
    }[];
    readonly retrievedChunks?: readonly {
      readonly chunkId: string;
      readonly score: number;
      readonly sourceTitle: string;
      readonly textSnippet: string;
    }[];
    readonly generatedText?: string;
    readonly citations?: readonly string[];
    readonly violations?: readonly string[];
    readonly missingNumericalEntities?: readonly string[];
    readonly loadStress?: {
      readonly targetComponent: string;
      readonly catalogCount: number;
      readonly targetChunkCount: number;
      readonly errorCounts: Record<string, number>;
      readonly stageP95Ms: Record<string, number>;
      readonly eventLoopLagMs?: number;
      readonly errorRate?: number;
    };
    readonly multiTurnTrajectory?: {
      readonly turns: readonly TurnEvaluationResult[];
      readonly jga: number;
      readonly crr: number | null;
      readonly refineF1: number | null;
      readonly resetCleanliness: number | null;
      readonly tokensIn?: number;
      readonly tokensOut?: number;
    };
  };
  readonly errorDetails?: string | null;
  readonly createdAt: Date | string;
}

export interface BenchmarkRunRecord {
  readonly id: string;
  readonly suiteName: string;
  readonly tier: BenchmarkTier;
  readonly triggerSource: string;
  readonly commitHash: string | null;
  readonly status: BenchmarkStatus;
  readonly totalTests: number;
  readonly passedTests: number;
  readonly failedTests: number;
  readonly durationMs: number;
  readonly concurrencyVus: number;
  readonly metricsSummary: BenchmarkRunMetricsSummary | null;
  readonly config: Record<string, unknown> | null;
  readonly createdAt: Date | string;
  readonly results?: readonly BenchmarkResultItem[];
}

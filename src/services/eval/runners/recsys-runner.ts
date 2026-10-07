/**
 * Offline Recommender Evaluation Runner.
 *
 * Evaluates policy checks and self-derived MAUT ranker agreement on authored
 * development personas. It does not measure independent shopper relevance.
 */
import { ASPECT_NAMES } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';
import { loadRecommendationCatalog } from '@/services/recommender/catalog';
import { rankCandidates, type RankResult } from '@/services/recommender/match';
import type { UserRequirements } from '@/services/recommender/requirements-schema';
import { evaluateCatalogUtility } from '../metrics/maut';
import { computeNdcgAtK, computeMrr, computePrecisionAtK } from '../metrics/ranking';
import { evaluatePickConstraints, computeAggregateCsr } from '../metrics/constraints';
import { computeCatalogDiversityMetrics, computeIntraListDiversity } from '../metrics/diversity';
import { computeStatisticalSummary } from '../metrics/statistics';
import type {
  BenchmarkResultItem,
  BenchmarkRunMetricsSummary,
  RecommenderPersonaFixture,
} from '../types';

export interface RecsysRunnerOptions {
  readonly db: AppDb;
  readonly fixtures: readonly RecommenderPersonaFixture[];
  readonly onProgress?: (step: number, total: number, currentItem: string) => void;
}

export interface RecsysRunnerOutput {
  readonly summary: BenchmarkRunMetricsSummary;
  readonly results: readonly BenchmarkResultItem[];
  readonly totalDurationMs: number;
}

export async function runRecsysOfflineBenchmark(
  options: RecsysRunnerOptions,
): Promise<RecsysRunnerOutput> {
  const { db, fixtures, onProgress } = options;
  const startTime = performance.now();

  // 1. Preload active catalog with aspect scores
  const catalog = await loadRecommendationCatalog(db);
  const totalCatalogSize = catalog.length;

  const results: BenchmarkResultItem[] = [];
  const ndcg3Scores: number[] = [];
  const mrrScores: number[] = [];
  const ildScores: number[] = [];
  const constraintResults = [];
  const allPicks: { phoneId: string; brand: string }[][] = [];
  let noResultPolicyCases = 0;
  let noResultPolicyPassed = 0;

  let step = 0;
  const total = fixtures.length;

  for (const fixture of fixtures) {
    step++;
    onProgress?.(step, total, fixture.name);

    const t0 = performance.now();

    // Derive a self-referential MAUT utility reference over this catalog.
    const mautAnalysis = evaluateCatalogUtility(catalog, fixture);
    const utilityByPhoneId = new Map<string, number>();
    const gradeByPhoneId = new Map<string, number>();

    for (const c of mautAnalysis.candidates) {
      utilityByPhoneId.set(c.phoneId, c.rawUtility);
      gradeByPhoneId.set(c.phoneId, c.relevanceGrade);
    }

    // Convert persona requirements to UserRequirements format for the ranker
    let formFactorObj: { screen_size_range_in?: [number, number]; foldable?: boolean } | undefined;
    if (fixture.requirements.form_factor === 'foldable') {
      formFactorObj = { foldable: true };
    } else if (fixture.requirements.form_factor === 'compact') {
      formFactorObj = { screen_size_range_in: [5.0, 6.3] };
    }

    const requirements: UserRequirements = {
      confidence: 1.0,
      clarifying_question: undefined,
      // The production shape requires max; preserve a minimum-only fixture as unbounded above.
      budget_usd: fixture.requirements.budget_usd
        ? {
            ...fixture.requirements.budget_usd,
            max: fixture.requirements.budget_usd.max ?? Infinity,
          }
        : null,
      form_factor: formFactorObj,
      priorities: fixture.requirements.priorities.map((p) => ({
        aspect: p.aspect,
        weight: p.weight,
      })),
      use_cases: [...fixture.requirements.use_cases],
      must_haves: [...fixture.requirements.must_haves],
      deal_breakers: [...fixture.requirements.deal_breakers],
      brand_preference: {
        liked: [...fixture.requirements.brand_preference.liked],
        disliked: [...fixture.requirements.brand_preference.disliked],
      },
    };

    const defaultWeights = new Map(ASPECT_NAMES.map((a) => [a, 1 / ASPECT_NAMES.length]));

    // Execute core recommender ranking
    const rankResult: RankResult = rankCandidates(catalog, requirements, defaultWeights);

    const latencyMs = Math.round(performance.now() - t0);

    // Extract actual pick grades and embeddings
    const actualGrades: number[] = rankResult.picks.map((p) => gradeByPhoneId.get(p.phoneId) ?? 0);
    const idealGrades: number[] = mautAnalysis.idealRanking.map((p) => p.relevanceGrade);

    // Compute metrics for this query
    const ndcg3 = computeNdcgAtK(actualGrades, idealGrades, 3);
    const mrr = computeMrr(actualGrades, 2);

    // Find spec embeddings for picks to compute Intra-List Diversity
    const pickEmbeddings = rankResult.picks.map((p) => {
      const entry = catalog.find((c) => c.phoneId === p.phoneId);
      return entry?.specEmbedding ?? null;
    });
    const ildEligible = pickEmbeddings.slice(0, 3).filter(Boolean).length >= 2;
    const ild = ildEligible ? computeIntraListDiversity(pickEmbeddings, 3) : null;

    // Evaluate constraints on top picks
    const constraintCheck = evaluatePickConstraints(
      rankResult.picks.map((p) => ({
        phoneId: p.phoneId,
        slug: p.slug,
        brand: p.brand,
        model: p.model,
        score: p.score,
        summary: p.summary,
        msrpUsd: p.msrpUsd,
        localPrice: null,
        localCurrency: null,
        imageUrl: p.imageUrl,
      })),
      fixture,
    );

    if (!fixture.expectNoResults && mautAnalysis.feasibleCount > 0) {
      ndcg3Scores.push(ndcg3.ndcg);
      mrrScores.push(mrr.mrr);
    }
    if (!fixture.expectNoResults && ild !== null) ildScores.push(ild);
    if (!fixture.expectNoResults) constraintResults.push(constraintCheck);
    allPicks.push(rankResult.picks.map((p) => ({ phoneId: p.phoneId, brand: p.brand })));

    // A no-result case tests the refusal policy and is excluded from ranking/CSR denominators.
    const noResultPass =
      fixture.expectNoResults === true &&
      mautAnalysis.feasibleCount === 0 &&
      rankResult.picks.length === 0;
    if (fixture.expectNoResults) {
      noResultPolicyCases++;
      if (noResultPass) noResultPolicyPassed++;
    }
    const isPass = fixture.expectNoResults
      ? noResultPass
      : mautAnalysis.feasibleCount > 0 && constraintCheck.allSatisfied;

    results.push({
      id: fixture.id,
      runId: '',
      testCaseId: fixture.id,
      category: 'recsys',
      inputQuery: fixture.userQuery,
      status: isPass ? 'pass' : 'fail',
      latencyMs,
      scores: {
        ndcg3: !fixture.expectNoResults && mautAnalysis.feasibleCount > 0 ? ndcg3.ndcg : null,
        mrr: fixture.expectNoResults ? null : mrr.mrr,
        ild3: fixture.expectNoResults ? null : ild,
        precision3: fixture.expectNoResults ? null : computePrecisionAtK(actualGrades, 3, 2),
        budgetSatisfied: fixture.expectNoResults ? null : constraintCheck.budgetSatisfied ? 1 : 0,
        dealbreakerAvoided: fixture.expectNoResults
          ? null
          : constraintCheck.dealbreakerAvoided
            ? 1
            : 0,
        noResultPolicyPassed: fixture.expectNoResults ? (noResultPass ? 1 : 0) : null,
      },
      tracePayload: {
        expectedNoResults: fixture.expectNoResults === true,
        feasibleCount: mautAnalysis.feasibleCount,
        actualPicks: rankResult.picks.map((p) => ({
          slug: p.slug,
          score: p.score,
          utilityGrade: gradeByPhoneId.get(p.phoneId) ?? 0,
          priceUsd: p.msrpUsd ? Number.parseFloat(p.msrpUsd) : null,
        })),
        idealPicks: mautAnalysis.idealRanking.slice(0, 5).map((p) => ({
          slug: p.slug,
          utilityGrade: p.relevanceGrade,
          utilityScore: p.rawUtility,
        })),
        violations: fixture.expectNoResults
          ? noResultPass
            ? []
            : [
                `Expected no result with zero feasible catalog items; found ${mautAnalysis.feasibleCount} feasible and ${rankResult.picks.length} picks`,
              ]
          : [
              ...constraintCheck.violations,
              ...(mautAnalysis.feasibleCount === 0
                ? ['No feasible catalog item under authored constraints']
                : []),
              ...(ild === null
                ? ['ILD unavailable: fewer than two selected phones have spec embeddings']
                : []),
            ],
      },
      createdAt: new Date(),
    });
  }

  const totalDurationMs = Math.round(performance.now() - startTime);

  // Compute aggregate statistics
  const ndcg3Summary = computeStatisticalSummary(ndcg3Scores);
  const ild3Summary = ildScores.length > 0 ? computeStatisticalSummary(ildScores) : undefined;
  const avgMrr =
    mrrScores.length > 0
      ? Math.round((mrrScores.reduce((a, b) => a + b, 0) / mrrScores.length) * 1000) / 1000
      : 0;

  const csr = computeAggregateCsr(constraintResults);
  const diversity = computeCatalogDiversityMetrics(allPicks, totalCatalogSize, ildScores);

  const passedTests = results.filter((r) => r.status === 'pass').length;
  const failedTests = results.filter((r) => r.status !== 'pass').length;

  return {
    summary: {
      ndcg3: ndcg3Summary,
      ildCoverageCases: ildScores.length,
      mrr: avgMrr,
      ...(ild3Summary ? { ild3: ild3Summary } : {}),
      catalogCoverage: diversity.catalogCoverage,
      giniCoefficient: diversity.giniCoefficient,
      ...(csr.budgetCsr != null ? { budgetCsr: csr.budgetCsr } : {}),
      ...(csr.dealbreakerCsr != null ? { dealbreakerCsr: csr.dealbreakerCsr } : {}),
      constraintPolicyCases: constraintResults.length,
      noResultPolicyCases,
      noResultPolicyPassed,
      totalTests: results.length,
      passedTests,
      failedTests,
    },
    results,
    totalDurationMs,
  };
}

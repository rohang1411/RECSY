/**
 * Offline Recommender Evaluation Runner.
 *
 * Evaluates ranking accuracy, hard constraints, and beyond-accuracy diversity
 * against the Golden Benchmark dataset using Multi-Attribute Utility Theory (MAUT).
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
  const ndcg5Scores: number[] = [];
  const mrrScores: number[] = [];
  const ildScores: number[] = [];
  const constraintResults = [];
  const allPicks: { phoneId: string; brand: string }[][] = [];

  let step = 0;
  const total = fixtures.length;

  for (const fixture of fixtures) {
    step++;
    onProgress?.(step, total, fixture.name);

    const t0 = performance.now();

    // Derive ground-truth MAUT utility over the catalog
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

    const budgetMax = fixture.requirements.budget_usd?.max;
    const requirements: UserRequirements = {
      confidence: 1.0,
      clarifying_question: undefined,
      budget_usd:
        budgetMax != null ? { min: fixture.requirements.budget_usd?.min, max: budgetMax } : null,
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
    const ndcg5 = computeNdcgAtK(actualGrades, idealGrades, 5);
    const mrr = computeMrr(actualGrades, 2);

    // Find spec embeddings for picks to compute Intra-List Diversity
    const pickEmbeddings = rankResult.picks.map((p) => {
      const entry = catalog.find((c) => c.phoneId === p.phoneId);
      return entry?.specEmbedding ?? null;
    });
    const ild = computeIntraListDiversity(pickEmbeddings, 3);

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

    ndcg3Scores.push(ndcg3.ndcg);
    ndcg5Scores.push(ndcg5.ndcg);
    mrrScores.push(mrr.mrr);
    ildScores.push(ild);
    constraintResults.push(constraintCheck);
    allPicks.push(rankResult.picks.map((p) => ({ phoneId: p.phoneId, brand: p.brand })));

    // Status: pass if NDCG@3 meets expectation (default 0.80) and constraints satisfied
    const minNdcg = fixture.minExpectedNdcg3 ?? 0.8;
    const isPass = ndcg3.ndcg >= minNdcg && constraintCheck.allSatisfied;
    const isWarn = ndcg3.ndcg >= minNdcg - 0.1;

    results.push({
      id: fixture.id,
      runId: '',
      testCaseId: fixture.id,
      category: 'recsys',
      inputQuery: fixture.userQuery,
      status: isPass ? 'pass' : isWarn ? 'warn' : 'fail',
      latencyMs,
      scores: {
        ndcg3: ndcg3.ndcg,
        ndcg5: ndcg5.ndcg,
        mrr: mrr.mrr,
        ild3: ild,
        precision3: computePrecisionAtK(actualGrades, 3, 2),
        budgetSatisfied: constraintCheck.budgetSatisfied ? 1 : 0,
        dealbreakerAvoided: constraintCheck.dealbreakerAvoided ? 1 : 0,
      },
      tracePayload: {
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
        violations: constraintCheck.violations,
      },
      createdAt: new Date(),
    });
  }

  const totalDurationMs = Math.round(performance.now() - startTime);

  // Compute aggregate statistics
  const ndcg3Summary = computeStatisticalSummary(ndcg3Scores);
  const ndcg5Summary = computeStatisticalSummary(ndcg5Scores);
  const ild3Summary = computeStatisticalSummary(ildScores);
  const avgMrr =
    mrrScores.length > 0
      ? Math.round((mrrScores.reduce((a, b) => a + b, 0) / mrrScores.length) * 1000) / 1000
      : 0;

  const csr = computeAggregateCsr(constraintResults);
  const diversity = computeCatalogDiversityMetrics(allPicks, totalCatalogSize, ildScores);

  const passedTests = results.filter((r) => r.status === 'pass').length;
  const failedTests = results.filter((r) => r.status === 'fail').length;

  return {
    summary: {
      ndcg3: ndcg3Summary,
      ndcg5: ndcg5Summary,
      mrr: avgMrr,
      ild3: ild3Summary,
      catalogCoverage: diversity.catalogCoverage,
      giniCoefficient: diversity.giniCoefficient,
      budgetCsr: csr.budgetCsr,
      dealbreakerCsr: csr.dealbreakerCsr,
      totalTests: results.length,
      passedTests,
      failedTests,
    },
    results,
    totalDurationMs,
  };
}

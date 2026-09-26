/**
 * Information Retrieval & Ranking Quality Metrics.
 *
 * Implements:
 *   - Graded Discounted Cumulative Gain (DCG@K)
 *   - Normalized Discounted Cumulative Gain (NDCG@K)
 *   - Mean Reciprocal Rank (MRR)
 *   - Precision@K & Recall@K
 *   - Mean Average Precision (MAP@K)
 */
import type { NdcgResult, MrrResult } from '../types';

export function computeDcg(grades: readonly number[], k: number): number {
  const topK = grades.slice(0, k);
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const rel = topK[i] ?? 0;
    // Standard exponential gain formulation: (2^rel - 1) / log2(i + 2)
    const numerator = Math.pow(2, rel) - 1;
    const denominator = Math.log2(i + 2); // i=0 -> log2(2) = 1
    dcg += numerator / denominator;
  }
  return dcg;
}

export function computeIdcg(idealGrades: readonly number[], k: number): number {
  const sorted = [...idealGrades].sort((a, b) => b - a);
  return computeDcg(sorted, k);
}

export function computeNdcgAtK(
  actualGrades: readonly number[],
  idealGrades: readonly number[],
  k: number,
): NdcgResult {
  const dcg = computeDcg(actualGrades, k);
  const idcg = computeIdcg(idealGrades, k);

  let ndcg = 0;
  if (idcg > 0) {
    ndcg = dcg / idcg;
  } else {
    // If IDCG is 0 (no relevant items exist), perfect ranking achieves 1.0, otherwise 0
    ndcg = dcg === 0 ? 1.0 : 0.0;
  }

  // Bound within [0, 1] to guard against floating point inaccuracies
  ndcg = Math.min(1.0, Math.max(0.0, ndcg));

  return {
    ndcg: Math.round(ndcg * 1000) / 1000,
    dcg: Math.round(dcg * 1000) / 1000,
    idcg: Math.round(idcg * 1000) / 1000,
    k,
    actualGrades: actualGrades.slice(0, k),
    idealGrades: idealGrades.slice(0, k),
  };
}

export function computeMrr(grades: readonly number[], relevanceThreshold = 2): MrrResult {
  for (let i = 0; i < grades.length; i++) {
    const rel = grades[i] ?? 0;
    if (rel >= relevanceThreshold) {
      const rank = i + 1;
      return {
        mrr: Math.round((1 / rank) * 1000) / 1000,
        firstRelevantRank: rank,
      };
    }
  }

  return {
    mrr: 0.0,
    firstRelevantRank: null,
  };
}

export function computePrecisionAtK(
  grades: readonly number[],
  k: number,
  relevanceThreshold = 2,
): number {
  const topK = grades.slice(0, k);
  if (topK.length === 0) return 0;
  const relevantCount = topK.filter((g) => g >= relevanceThreshold).length;
  return Math.round((relevantCount / topK.length) * 1000) / 1000;
}

export function computeAveragePrecision(
  grades: readonly number[],
  k: number,
  relevanceThreshold = 2,
): number {
  const topK = grades.slice(0, k);
  let hits = 0;
  let sumPrecision = 0;

  for (let i = 0; i < topK.length; i++) {
    if ((topK[i] ?? 0) >= relevanceThreshold) {
      hits++;
      sumPrecision += hits / (i + 1);
    }
  }

  if (hits === 0) return 0;
  return Math.round((sumPrecision / hits) * 1000) / 1000;
}

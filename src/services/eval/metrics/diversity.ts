/**
 * Beyond-Accuracy Diversity & Catalog Health Metrics.
 *
 * Implements:
 *   - Intra-List Diversity (ILD@K) via pairwise embedding cosine distance
 *   - Catalog Coverage (%)
 *   - Gini Coefficient of recommendation frequency distribution
 *   - Shannon Entropy of brand exposure
 */
import { cosineSimilarity } from '@/services/recommender/vector-utils';
import type { DiversityMetrics } from '../types';

export function computeIntraListDiversity(
  specEmbeddings: readonly (readonly number[] | null)[],
  k = 3,
): number {
  const validEmbeddings = specEmbeddings
    .slice(0, k)
    .filter((e): e is readonly number[] => e != null && e.length > 0);

  const n = validEmbeddings.length;
  if (n < 2) {
    return 0.0;
  }

  let totalDistance = 0;
  let pairCount = 0;

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const e1 = validEmbeddings[i];
      const e2 = validEmbeddings[j];
      if (e1 && e2) {
        const sim = cosineSimilarity(e1, e2);
        // Distance in [0, 2] bounded to [0, 1]
        const distance = Math.max(0, 1 - Math.max(0, sim));
        totalDistance += distance;
        pairCount++;
      }
    }
  }

  if (pairCount === 0) return 0.0;
  return Math.round((totalDistance / pairCount) * 1000) / 1000;
}

export function computeGiniCoefficient(frequencies: readonly number[]): number {
  const n = frequencies.length;
  if (n === 0) return 0.0;

  const sorted = [...frequencies].sort((a, b) => a - b);
  const totalSum = sorted.reduce((acc, val) => acc + val, 0);

  if (totalSum === 0) return 0.0;

  let cumulativeSum = 0;
  for (let i = 0; i < n; i++) {
    cumulativeSum += (2 * (i + 1) - n - 1) * (sorted[i] ?? 0);
  }

  const gini = cumulativeSum / (n * totalSum);
  return Math.round(Math.max(0, Math.min(1, gini)) * 1000) / 1000;
}

export function computeShannonEntropy(counts: Record<string, number>): number {
  const values = Object.values(counts);
  const total = values.reduce((acc, v) => acc + v, 0);
  if (total === 0) return 0.0;

  let entropy = 0;
  for (const count of values) {
    if (count > 0) {
      const p = count / total;
      entropy -= p * Math.log2(p);
    }
  }

  return Math.round(entropy * 1000) / 1000;
}

export function computeCatalogDiversityMetrics(
  allRecommendedPicks: readonly (readonly { readonly phoneId: string; readonly brand: string }[])[],
  totalActiveCatalogCount: number,
  ildScores: readonly number[],
): DiversityMetrics {
  const phoneFrequency = new Map<string, number>();
  const brandFrequency: Record<string, number> = {};

  for (const pickSet of allRecommendedPicks) {
    for (const pick of pickSet) {
      phoneFrequency.set(pick.phoneId, (phoneFrequency.get(pick.phoneId) ?? 0) + 1);
      brandFrequency[pick.brand] = (brandFrequency[pick.brand] ?? 0) + 1;
    }
  }

  const uniquePhones = phoneFrequency.size;
  const catalogCoverage =
    totalActiveCatalogCount > 0
      ? Math.round((uniquePhones / totalActiveCatalogCount) * 1000) / 1000
      : 0.0;

  // Build full frequency vector including unrecommended phones (frequency = 0)
  const allFrequencies: number[] = Array.from(phoneFrequency.values());
  const unrecommendedCount = Math.max(0, totalActiveCatalogCount - uniquePhones);
  for (let i = 0; i < unrecommendedCount; i++) {
    allFrequencies.push(0);
  }

  const gini = computeGiniCoefficient(allFrequencies);
  const entropy = computeShannonEntropy(brandFrequency);
  const avgIld =
    ildScores.length > 0
      ? Math.round((ildScores.reduce((a, b) => a + b, 0) / ildScores.length) * 1000) / 1000
      : 0.0;

  return {
    ild: avgIld,
    catalogCoverage,
    giniCoefficient: gini,
    brandEntropy: entropy,
    uniquePhonesRecommended: uniquePhones,
    totalCatalogSize: totalActiveCatalogCount,
  };
}

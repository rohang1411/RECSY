/**
 * Multi-Attribute Utility Theory (MAUT) and Constraint Satisfaction (CSP) engine.
 *
 * Self-derived ranker-utility reference, not independent relevance ground truth.
 * It is useful for implementation consistency checks only.
 */
import { ASPECT_NAMES } from '@/lib/constants';
import type { PhoneCatalogEntry } from '@/services/recommender/catalog';
import {
  buildSearchHaystack,
  dealBreakerHit,
  mustHaveMatchRatio,
  resolveAspectWeights,
} from '@/services/recommender/match';
import { cosineSimilarity } from '@/services/recommender/vector-utils';
import { passesVerifiedHardFeatures } from '@/services/recommender/hard-features';
import type { RecommenderPersonaFixture } from '../types';

export interface EvaluatedCandidateUtility {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly priceUsd: number | null;
  readonly satisfiesHardConstraints: boolean;
  readonly constraintViolations: readonly string[];
  readonly rawUtility: number;
  readonly relevanceGrade: number; // 0, 1, 2, 3
}

export interface CatalogUtilityAnalysis {
  readonly candidates: readonly EvaluatedCandidateUtility[];
  readonly feasibleCount: number;
  readonly idealRanking: readonly EvaluatedCandidateUtility[];
  readonly p50Utility: number;
  readonly p70Utility: number;
  readonly p90Utility: number;
}

export function checkCandidateConstraints(
  phone: PhoneCatalogEntry,
  fixture: RecommenderPersonaFixture,
): { satisfies: boolean; violations: string[] } {
  const violations: string[] = [];
  const req = fixture.requirements;
  const price = phone.msrpUsd ? Number.parseFloat(phone.msrpUsd) : null;

  if (
    !passesVerifiedHardFeatures(phone, {
      must_haves: [...req.must_haves],
      deal_breakers: [...req.deal_breakers],
    })
  )
    violations.push('Mandatory feature/exclusion compliance is unverified or unsupported');

  // 1. Budget constraint. Missing or invalid price cannot establish feasibility.
  if (req.budget_usd?.max != null || req.budget_usd?.min != null) {
    if (price == null || !Number.isFinite(price)) {
      violations.push('Price is missing or invalid under an active budget');
    } else {
      if (req.budget_usd.max != null && price > req.budget_usd.max)
        violations.push(`Price $${price} exceeds budget max $${req.budget_usd.max}`);
      if (req.budget_usd.min != null && price < req.budget_usd.min)
        violations.push(`Price $${price} is below budget min $${req.budget_usd.min}`);
    }
  }

  // 2. Dealbreaker constraint
  const haystack = buildSearchHaystack(phone);
  if (req.deal_breakers && req.deal_breakers.length > 0) {
    if (dealBreakerHit(haystack, req.deal_breakers)) {
      violations.push(`Contains dealbreaker term in spec: ${req.deal_breakers.join(', ')}`);
    }
  }

  // 3. Platform / OS constraint
  const osLower = (phone.spec?.os ?? '').toLowerCase();
  const brandLower = phone.brand.toLowerCase();
  for (const mustHave of req.must_haves ?? []) {
    const m = mustHave.toLowerCase();
    if (m === 'ios' || m === 'apple' || m === 'iphone') {
      if (brandLower !== 'apple' && !osLower.includes('ios')) {
        violations.push('Requires iOS/Apple platform');
      }
    } else if (m === 'android') {
      if (brandLower === 'apple' || osLower.includes('ios')) {
        violations.push('Requires Android platform');
      }
    }
  }

  // 4. Form factor
  if (req.form_factor === 'foldable') {
    const isFoldable = phone.spec?.foldable === true;
    if (!isFoldable) {
      violations.push('Requires foldable form factor');
    }
  } else if (req.form_factor === 'compact') {
    const sz = phone.spec?.display?.size_in;
    if (sz == null || sz < 5.0 || sz > 6.3)
      violations.push(`Display size ${sz ?? 'unknown'}" is outside compact range [5.0", 6.3"]`);
  }

  // 5. Disliked brands
  if (req.brand_preference?.disliked) {
    for (const disliked of req.brand_preference.disliked) {
      if (brandLower.includes(disliked.toLowerCase())) {
        violations.push(`Brand ${phone.brand} is explicitly disliked`);
      }
    }
  }

  return {
    satisfies: violations.length === 0,
    violations,
  };
}

export function computeCandidateUtilityScore(
  phone: PhoneCatalogEntry,
  fixture: RecommenderPersonaFixture,
  queryEmbedding: readonly number[] | null = null,
): number {
  const req = fixture.requirements;
  const defaultWeights = new Map(ASPECT_NAMES.map((a) => [a, 1 / ASPECT_NAMES.length]));
  const weights = resolveAspectWeights(
    {
      confidence: 1.0,
      budget_usd: req.budget_usd
        ? { ...req.budget_usd, max: req.budget_usd.max ?? Infinity }
        : null,
      priorities: req.priorities,
      use_cases: [...(req.use_cases ?? [])],
      must_haves: [...(req.must_haves ?? [])],
      deal_breakers: [...(req.deal_breakers ?? [])],
      brand_preference: {
        liked: [...(req.brand_preference?.liked ?? [])],
        disliked: [...(req.brand_preference?.disliked ?? [])],
      },
      clarifying_question: undefined,
    },
    defaultWeights,
  );

  // Weighted aspect utility
  let aspectUtility = 0;
  for (const a of ASPECT_NAMES) {
    const w = weights.get(a) ?? 0;
    const score = phone.aspectScores.get(a) ?? 5.0; // default neutral
    const normalizedScore = (score - 1) / 9; // scale [1, 10] -> [0, 1]
    aspectUtility += w * normalizedScore;
  }

  // Must-have keyword match factor
  const haystack = buildSearchHaystack(phone);
  const nonPlatformMustHaves = (req.must_haves ?? []).filter(
    (m) => !['ios', 'apple', 'iphone', 'android'].includes(m.toLowerCase()),
  );
  const ratio = mustHaveMatchRatio(haystack, nonPlatformMustHaves);
  aspectUtility = aspectUtility * (0.72 + 0.28 * ratio);

  // Semantic similarity bonus
  let semanticBonus = 0;
  if (queryEmbedding && phone.specEmbedding) {
    const sim = cosineSimilarity(queryEmbedding, phone.specEmbedding);
    if (Number.isFinite(sim)) {
      semanticBonus = Math.max(0, sim) * 0.15; // 15% influence
    }
  }

  // Liked brand bonus
  let brandBonus = 0;
  const brandLower = phone.brand.toLowerCase();
  for (const liked of req.brand_preference?.liked ?? []) {
    if (brandLower.includes(liked.toLowerCase())) {
      brandBonus += 0.05;
      break;
    }
  }

  return aspectUtility + semanticBonus + brandBonus;
}

export function evaluateCatalogUtility(
  catalog: readonly PhoneCatalogEntry[],
  fixture: RecommenderPersonaFixture,
  queryEmbedding: readonly number[] | null = null,
): CatalogUtilityAnalysis {
  const intermediate: {
    phone: PhoneCatalogEntry;
    satisfies: boolean;
    violations: string[];
    price: number | null;
    rawUtility: number;
  }[] = [];

  const feasibleUtilities: number[] = [];

  for (const phone of catalog) {
    const { satisfies, violations } = checkCandidateConstraints(phone, fixture);
    const price = phone.msrpUsd ? Number.parseFloat(phone.msrpUsd) : null;
    const rawUtility = satisfies ? computeCandidateUtilityScore(phone, fixture, queryEmbedding) : 0;

    if (satisfies) {
      feasibleUtilities.push(rawUtility);
    }

    intermediate.push({
      phone,
      satisfies,
      violations,
      price,
      rawUtility,
    });
  }

  feasibleUtilities.sort((a, b) => a - b);
  const feasibleCount = feasibleUtilities.length;

  const p50 = feasibleCount > 0 ? (feasibleUtilities[Math.floor(feasibleCount * 0.5)] ?? 0) : 0;
  const p70 = feasibleCount > 0 ? (feasibleUtilities[Math.floor(feasibleCount * 0.7)] ?? 0) : 0;
  const p90 = feasibleCount > 0 ? (feasibleUtilities[Math.floor(feasibleCount * 0.9)] ?? 0) : 0;

  const evaluated: EvaluatedCandidateUtility[] = intermediate.map((item) => {
    let grade = 0;
    if (item.satisfies) {
      if (item.rawUtility >= p90 && p90 > 0) {
        grade = 3;
      } else if (item.rawUtility >= p70 && p70 > 0) {
        grade = 2;
      } else if (item.rawUtility >= p50 && p50 > 0) {
        grade = 1;
      } else {
        grade = 1; // within constraints gets at least 1
      }
    }

    return {
      phoneId: item.phone.phoneId,
      slug: item.phone.slug,
      brand: item.phone.brand,
      model: item.phone.model,
      priceUsd: item.price,
      satisfiesHardConstraints: item.satisfies,
      constraintViolations: item.violations,
      rawUtility: Math.round(item.rawUtility * 1000) / 1000,
      relevanceGrade: grade,
    };
  });

  // Ideal ranking sorted descending by relevance grade, then raw utility
  const idealRanking = [...evaluated]
    .filter((e) => e.satisfiesHardConstraints)
    .sort((a, b) => {
      if (b.relevanceGrade !== a.relevanceGrade) {
        return b.relevanceGrade - a.relevanceGrade;
      }
      return b.rawUtility - a.rawUtility;
    });

  return {
    candidates: evaluated,
    feasibleCount,
    idealRanking,
    p50Utility: p50,
    p70Utility: p70,
    p90Utility: p90,
  };
}

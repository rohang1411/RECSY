/**
 * Hard Constraint Satisfaction (CSR) & Policy Compliance Metrics.
 *
 * Recommender systems in production must guarantee zero-tolerance enforcement
 * of non-negotiable user boundaries (e.g. strict budgets, dealbreakers, OS platform).
 */
import type { RecommendApiPick } from '@/services/recommender/run-recommendation';
import type { ConstraintSatisfactionResult, RecommenderPersonaFixture } from '../types';

export function evaluatePickConstraints(
  picks: readonly RecommendApiPick[],
  fixture: RecommenderPersonaFixture,
): ConstraintSatisfactionResult {
  const violations: string[] = [];
  const req = fixture.requirements;
  const maxBudget = req.budget_usd?.max;
  const minBudget = req.budget_usd?.min;
  const unverified = [
    ...req.must_haves.filter(
      (m) => !['android', 'ios', 'iphone', 'apple'].includes(m.toLowerCase()),
    ),
    ...req.deal_breakers,
  ];
  if (unverified.length)
    violations.push(
      `[Unverified Constraint Coverage] This pick-text evaluator does not verify: ${unverified.join(', ')}`,
    );

  // Zero recommendations returned is a failure on answerable recommendation requests
  if (picks.length === 0) {
    violations.push(
      '[Empty Recommendation Failure] No phones were returned for persona requirements',
    );
    return {
      budgetSatisfied: false,
      dealbreakerAvoided: false,
      platformSatisfied: false,
      allSatisfied: false,
      violations,
    };
  }

  let budgetOk = true;
  let dealbreakerOk = true;
  let platformOk = true;

  for (const pick of picks) {
    const price = pick.msrpUsd ? Number.parseFloat(pick.msrpUsd) : null;

    // 1. Budget gate
    if (maxBudget != null || minBudget != null) {
      if (price == null || !Number.isFinite(price)) {
        budgetOk = false;
        violations.push(
          `[Budget Verification Failure] ${pick.brand} ${pick.model} has unknown price; cannot verify the requested budget (${minBudget == null ? 'no minimum' : `minimum $${minBudget}`}, ${maxBudget == null ? 'no maximum' : `maximum $${maxBudget}`})`,
        );
      } else if (maxBudget != null && price > maxBudget) {
        budgetOk = false;
        violations.push(
          `[Budget Violation] ${pick.brand} ${pick.model} ($${price}) exceeds max budget of $${maxBudget}`,
        );
      }
      if (price != null && Number.isFinite(price) && minBudget != null && price < minBudget) {
        budgetOk = false;
        violations.push(
          `[Budget Violation] ${pick.brand} ${pick.model} ($${price}) is below min budget of $${minBudget}`,
        );
      }
    }

    // 2. Dealbreaker gate
    const pickText = `${pick.brand} ${pick.model} ${pick.summary}`.toLowerCase();
    for (const d of req.deal_breakers ?? []) {
      const term = d.trim().toLowerCase();
      if (term && pickText.includes(term)) {
        dealbreakerOk = false;
        violations.push(
          `[Dealbreaker Intrusion] ${pick.brand} ${pick.model} contains dealbreaker keyword: "${term}"`,
        );
      }
    }

    // 3. Platform OS gate
    const brandLower = pick.brand.toLowerCase();
    for (const mustHave of req.must_haves ?? []) {
      const m = mustHave.toLowerCase();
      if (m === 'ios' || m === 'apple' || m === 'iphone') {
        if (brandLower !== 'apple') {
          platformOk = false;
          violations.push(
            `[Platform Violation] Pick ${pick.brand} ${pick.model} violates mandatory iOS requirement`,
          );
        }
      } else if (m === 'android') {
        if (brandLower === 'apple') {
          platformOk = false;
          violations.push(
            `[Platform Violation] Pick ${pick.brand} ${pick.model} violates mandatory Android requirement`,
          );
        }
      }
    }

    // 4. Disliked brand gate
    for (const disliked of req.brand_preference?.disliked ?? []) {
      if (brandLower.includes(disliked.toLowerCase())) {
        dealbreakerOk = false;
        violations.push(
          `[Brand Violation] Pick ${pick.brand} ${pick.model} is in disliked brand list`,
        );
      }
    }
  }

  return {
    budgetSatisfied: budgetOk,
    dealbreakerAvoided: dealbreakerOk,
    platformSatisfied: platformOk,
    allSatisfied: budgetOk && dealbreakerOk && platformOk && unverified.length === 0,
    violations,
  };
}

export function computeAggregateCsr(results: readonly ConstraintSatisfactionResult[]): {
  readonly budgetCsr: number | null;
  readonly dealbreakerCsr: number | null;
  readonly platformCsr: number | null;
  readonly overallCsr: number | null;
} {
  if (results.length === 0) {
    return { budgetCsr: null, dealbreakerCsr: null, platformCsr: null, overallCsr: null };
  }

  const budgetPasses = results.filter((r) => r.budgetSatisfied).length;
  const dealbreakerPasses = results.filter((r) => r.dealbreakerAvoided).length;
  const platformPasses = results.filter((r) => r.platformSatisfied).length;
  const allPasses = results.filter((r) => r.allSatisfied).length;

  return {
    budgetCsr: Math.round((budgetPasses / results.length) * 1000) / 1000,
    dealbreakerCsr: Math.round((dealbreakerPasses / results.length) * 1000) / 1000,
    platformCsr: Math.round((platformPasses / results.length) * 1000) / 1000,
    overallCsr: Math.round((allPasses / results.length) * 1000) / 1000,
  };
}

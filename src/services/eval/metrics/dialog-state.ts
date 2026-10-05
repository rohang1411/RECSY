/**
 * Multi-Turn Dialog State Tracking (DST) & Conversational Recommender (CRS) Engine.
 *
 * Implements research-grade evaluation of multi-turn conversational recommendation trajectories:
 *   1. Joint Goal Accuracy (JGA) — slot-value tracking fidelity across turns
 *   2. Constraint Retention Rate (CRR) — anti-forgetting across long context
 *   3. Constraint Mutation Latency (CML) — immediate responsiveness to user updates
 *   4. Refine vs Expand Scope Accuracy — subset vs full catalog fidelity
 *   5. Reset Purge Cleanliness — complete erasure of residual state on hard resets
 *   6. Turn NDCG@3 — dynamic utility ranking at each dialog turn
 */
import { ASPECT_NAMES } from '@/lib/constants';
import type { PhoneCatalogEntry } from '@/services/recommender/catalog';
import { aspectsByWeight, resolveAspectWeights } from '@/services/recommender/match';
import type { RecommendPipelineResult } from '@/services/recommender/run-recommendation';
import { evaluateCatalogUtility } from './maut';
import { computeNdcgAtK } from './ranking';
import type { TrajectoryTurn, TurnEvaluationResult } from '../types';

export interface TurnEvaluationInput {
  readonly turn: TrajectoryTurn;
  readonly result: RecommendPipelineResult;
  readonly priorTurnResults: readonly TurnEvaluationResult[];
  readonly catalog: readonly PhoneCatalogEntry[];
  readonly latencyMs: number;
}

export function evaluateTurnDialogState(input: TurnEvaluationInput): TurnEvaluationResult {
  const { turn, result, priorTurnResults, catalog, latencyMs } = input;
  const violations: string[] = [];
  const req = result.requirements;

  // 1. Kind matching ('results' vs 'clarify')
  const expectedKind = turn.expectedKind ?? 'results';
  const kindMatched = result.kind === expectedKind;
  if (!kindMatched) {
    violations.push(`Expected kind "${expectedKind}" but got "${result.kind}"`);
  }

  // 2. Joint Goal Accuracy (JGA) evaluation
  let slotChecksTotal = 0;
  let slotChecksPassed = 0;

  if (turn.expectedSlots) {
    const es = turn.expectedSlots;

    // Budget check
    if (es.budgetMaxUsd !== undefined) {
      slotChecksTotal++;
      if (es.budgetMaxUsd === null) {
        if (req.budget_usd?.max == null) {
          slotChecksPassed++;
        } else {
          violations.push(`JGA Budget mismatch: expected no budget, got $${req.budget_usd?.max}`);
        }
      } else if (req.budget_usd?.max === es.budgetMaxUsd) {
        slotChecksPassed++;
      } else {
        violations.push(
          `JGA Budget mismatch: expected $${es.budgetMaxUsd}, got $${req.budget_usd?.max ?? 'none'}`,
        );
      }
    }

    // Disliked brands check
    if (es.dislikedBrands && es.dislikedBrands.length > 0) {
      slotChecksTotal++;
      const currentDisliked = (req.brand_preference?.disliked ?? []).map((b) => b.toLowerCase());
      const allFound = es.dislikedBrands.every((b) => currentDisliked.includes(b.toLowerCase()));
      const noExtras = currentDisliked.every((b) =>
        es.dislikedBrands!.some((ed) => ed.toLowerCase() === b),
      );
      if (allFound && noExtras) {
        slotChecksPassed++;
      } else {
        violations.push(
          `JGA Disliked brands mismatch: expected [${es.dislikedBrands.join(', ')}], got [${currentDisliked.join(', ')}]`,
        );
      }
    }

    // Liked brands check
    if (es.likedBrands && es.likedBrands.length > 0) {
      slotChecksTotal++;
      const currentLiked = (req.brand_preference?.liked ?? []).map((b) => b.toLowerCase());
      const allFound = es.likedBrands.every((b) => currentLiked.includes(b.toLowerCase()));
      const noExtras = currentLiked.every((b) =>
        es.likedBrands!.some((el) => el.toLowerCase() === b),
      );
      if (allFound && noExtras) {
        slotChecksPassed++;
      } else {
        violations.push(
          `JGA Liked brands mismatch: expected [${es.likedBrands.join(', ')}], got [${currentLiked.join(', ')}]`,
        );
      }
    }

    // Must-haves check
    if (es.mustHaves && es.mustHaves.length > 0) {
      slotChecksTotal++;
      const currentMustHaves = (req.must_haves ?? []).map((m) => m.toLowerCase());
      const allFound = es.mustHaves.every((m) =>
        currentMustHaves.some((cm) => cm.includes(m.toLowerCase())),
      );
      if (allFound) {
        slotChecksPassed++;
      } else {
        violations.push(
          `JGA Must-haves mismatch: expected [${es.mustHaves.join(', ')}], got [${currentMustHaves.join(', ')}]`,
        );
      }
    }

    // Form factor check
    if (es.formFactor !== undefined) {
      slotChecksTotal++;
      if (es.formFactor === 'compact') {
        const sz = req.form_factor?.screen_size_range_in;
        if (sz && sz[1] <= 6.4) {
          slotChecksPassed++;
        } else {
          violations.push(
            `JGA Form factor mismatch: expected compact (<=6.4"), got ${sz ? sz.join('-') : 'none'}`,
          );
        }
      } else if (es.formFactor === 'foldable') {
        if (req.form_factor?.foldable === true) {
          slotChecksPassed++;
        } else {
          violations.push('JGA Form factor mismatch: expected foldable, got false/undefined');
        }
      }
    }

    // Top aspect check
    if (es.topAspect !== undefined) {
      slotChecksTotal++;
      const defaultWeights = new Map(ASPECT_NAMES.map((a) => [a, 1 / ASPECT_NAMES.length]));
      const resolved = resolveAspectWeights(req, defaultWeights);
      const sortedAspects = aspectsByWeight(resolved);
      if (sortedAspects[0] === es.topAspect) {
        slotChecksPassed++;
      } else {
        violations.push(
          `JGA Top aspect mismatch: expected "${es.topAspect}", got "${sortedAspects[0]}"`,
        );
      }
    }
  }

  // Exact-Match JGA: strictly 1.0 iff ALL slot checks pass, else 0.0.
  // Slot Accuracy: partial credit across individual slots.
  const exactJga = slotChecksTotal > 0 ? (slotChecksPassed === slotChecksTotal ? 1.0 : 0.0) : 1.0;
  const slotAccuracy = slotChecksTotal > 0 ? slotChecksPassed / slotChecksTotal : 1.0;
  const jgaScore = exactJga;

  // 3. Hard constraints on returned picks
  let hardConstraintSatisfied = true;
  const picks = result.kind === 'results' ? result.picks : [];

  for (const pick of picks) {
    const price = pick.msrpUsd ? Number.parseFloat(pick.msrpUsd) : null;

    // Budget gate
    if (req.budget_usd?.max != null && price != null && price > req.budget_usd.max) {
      hardConstraintSatisfied = false;
      violations.push(
        `Pick ${pick.brand} ${pick.model} ($${price}) violates budget max $${req.budget_usd.max}`,
      );
    }

    // Forbidden brands gate (e.g. anti-brand pivot)
    if (turn.forbiddenBrands && turn.forbiddenBrands.length > 0) {
      const bLower = pick.brand.toLowerCase();
      for (const fb of turn.forbiddenBrands) {
        if (bLower.includes(fb.toLowerCase())) {
          hardConstraintSatisfied = false;
          violations.push(`Pick ${pick.brand} ${pick.model} violates forbidden brand "${fb}"`);
        }
      }
    }

    // Forbidden slugs gate
    if (turn.forbiddenSlugs && turn.forbiddenSlugs.includes(pick.slug)) {
      hardConstraintSatisfied = false;
      violations.push(`Pick ${pick.slug} is explicitly forbidden for this turn`);
    }
  }

  // 4. Constraint Mutation Responsiveness (Immediate 0-turn latency)
  let mutationResponsiveness = true;
  if (turn.forbiddenBrands && turn.forbiddenBrands.length > 0) {
    const hasForbiddenPick = picks.some((p) =>
      turn.forbiddenBrands?.some((fb) => p.brand.toLowerCase().includes(fb.toLowerCase())),
    );
    if (hasForbiddenPick) mutationResponsiveness = false;
  }
  if (turn.expectedSlots?.budgetMaxUsd != null) {
    const overBudgetPick = picks.some((p) => {
      const price = p.msrpUsd ? Number.parseFloat(p.msrpUsd) : 0;
      return price > (turn.expectedSlots?.budgetMaxUsd ?? Infinity);
    });
    if (overBudgetPick) mutationResponsiveness = false;
  }

  // 5. Constraint Retention Rate (Anti-Forgetting)
  const isRetentionTurn = Boolean(
    turn.mustPreservePriorSlots && turn.mustPreservePriorSlots.length > 0,
  );
  let retentionChecksTotal = 0;
  let retentionChecksPassed = 0;

  if (isRetentionTurn && turn.mustPreservePriorSlots) {
    for (const slot of turn.mustPreservePriorSlots) {
      retentionChecksTotal++;
      if (slot === 'budget') {
        const lastBudget = priorTurnResults
          .slice()
          .reverse()
          .find((pt) => pt.activeRequirements.budget_usd?.max != null)?.activeRequirements
          .budget_usd?.max;
        if (lastBudget != null && req.budget_usd?.max === lastBudget) {
          retentionChecksPassed++;
        } else {
          violations.push(`Constraint Decay: budget $${lastBudget} was forgotten`);
        }
      } else if (slot === 'disliked_brands') {
        const lastDisliked =
          priorTurnResults
            .slice()
            .reverse()
            .find((pt) => pt.activeRequirements.brand_preference?.disliked?.length)
            ?.activeRequirements.brand_preference?.disliked ?? [];
        const currentDisliked = (req.brand_preference?.disliked ?? []).map((b) => b.toLowerCase());
        const allRetained = lastDisliked.every((b) => currentDisliked.includes(b.toLowerCase()));
        if (allRetained) {
          retentionChecksPassed++;
        } else {
          violations.push(
            `Constraint Decay: disliked brands [${lastDisliked.join(', ')}] forgotten`,
          );
        }
      } else if (slot === 'platform') {
        const lastPlatform = priorTurnResults
          .slice()
          .reverse()
          .find((pt) =>
            pt.activeRequirements.must_haves?.some((m) =>
              ['android', 'ios', 'apple'].includes(m.toLowerCase()),
            ),
          );
        const prevPlatformMust = lastPlatform?.activeRequirements.must_haves?.find((m) =>
          ['android', 'ios', 'apple'].includes(m.toLowerCase()),
        );
        if (prevPlatformMust) {
          const currentMustHaves = (req.must_haves ?? []).map((m) => m.toLowerCase());
          if (currentMustHaves.includes(prevPlatformMust.toLowerCase())) {
            retentionChecksPassed++;
          } else {
            violations.push(`Constraint Decay: platform "${prevPlatformMust}" forgotten`);
          }
        } else {
          retentionChecksPassed++;
        }
      }
    }
  }

  const retentionScore =
    retentionChecksTotal > 0 ? retentionChecksPassed / retentionChecksTotal : 1.0;

  // 5b. Reset Purge Cleanliness
  let resetCleanliness: number | undefined;
  if (turn.isReset) {
    let purgeLeaks = 0;
    const lastRequirements = priorTurnResults[priorTurnResults.length - 1]?.activeRequirements;
    if (lastRequirements) {
      if (
        lastRequirements.budget_usd?.max != null &&
        (turn.expectedSlots?.budgetMaxUsd === undefined ||
          turn.expectedSlots?.budgetMaxUsd === null)
      ) {
        if (req.budget_usd?.max != null) {
          purgeLeaks++;
          violations.push(
            `Reset Purge Leak: prior budget $${lastRequirements.budget_usd.max} persisted across reset`,
          );
        }
      }
      if (
        (lastRequirements.brand_preference?.disliked?.length ?? 0) > 0 &&
        (!turn.expectedSlots?.dislikedBrands || turn.expectedSlots.dislikedBrands.length === 0)
      ) {
        if ((req.brand_preference?.disliked?.length ?? 0) > 0) {
          purgeLeaks++;
          violations.push(
            `Reset Purge Leak: prior disliked brands [${lastRequirements.brand_preference?.disliked?.join(', ')}] persisted across reset`,
          );
        }
      }
      if (
        (lastRequirements.must_haves?.length ?? 0) > 0 &&
        (!turn.expectedSlots?.mustHaves || turn.expectedSlots.mustHaves.length === 0)
      ) {
        if ((req.must_haves?.length ?? 0) > 0) {
          purgeLeaks++;
          violations.push(
            `Reset Purge Leak: prior must-haves [${lastRequirements.must_haves?.join(', ')}] persisted across reset`,
          );
        }
      }
    }
    resetCleanliness = purgeLeaks === 0 ? 1.0 : 0.0;
  }

  // 6. Refine Intent Accuracy
  let refineIntentMatched = true;
  if (turn.expectRefineIntent !== undefined) {
    const isRefined = result.kind === 'results' && result.refined === true;
    if (isRefined !== turn.expectRefineIntent) {
      refineIntentMatched = false;
      violations.push(
        `Refine intent mismatch: expected refined=${turn.expectRefineIntent}, got refined=${isRefined}`,
      );
    }

    if (turn.expectRefineIntent && priorTurnResults.length > 0) {
      const priorPicks = priorTurnResults[priorTurnResults.length - 1]?.picks ?? [];
      const priorIdSet = new Set(priorPicks.map((p) => p.phoneId));
      const allSubset = picks.every((p) => priorIdSet.has(p.phoneId));
      if (!allSubset) {
        refineIntentMatched = false;
        violations.push('Refine scope violation: returned picks that were not in prior pick set');
      }
    }
  }

  // 7. Dynamic NDCG@3 for this turn (if results)
  let ndcg3: number | undefined;
  if (result.kind === 'results' && picks.length > 0) {
    const dummyFixture = {
      id: `turn-${turn.turnIndex}`,
      name: `Turn ${turn.turnIndex}`,
      category: 'multi-turn',
      userQuery: turn.userMessage,
      requirements: {
        budget_usd: req.budget_usd
          ? { max: req.budget_usd.max, min: req.budget_usd.min }
          : undefined,
        priorities: req.priorities ?? [],
        use_cases: [...(req.use_cases ?? [])],
        must_haves: [...(req.must_haves ?? [])],
        deal_breakers: [...(req.deal_breakers ?? [])],
        brand_preference: req.brand_preference ?? { liked: [], disliked: [] },
      },
    };

    const maut = evaluateCatalogUtility(catalog, dummyFixture);
    const gradeMap = new Map<string, number>();
    for (const c of maut.candidates) {
      gradeMap.set(c.phoneId, c.relevanceGrade);
    }
    const actualGrades = picks.map((p) => gradeMap.get(p.phoneId) ?? 0);
    const idealGrades = maut.idealRanking.slice(0, 3).map((p) => p.relevanceGrade);
    ndcg3 = computeNdcgAtK(actualGrades, idealGrades, 3).ndcg;
  }

  return {
    turnIndex: turn.turnIndex,
    userMessage: turn.userMessage,
    kind: result.kind,
    kindMatched,
    latencyMs,
    jgaScore,
    slotAccuracy,
    isRetentionTurn,
    retentionChecksTotal,
    retentionChecksPassed,
    constraintViolations: violations,
    hardConstraintSatisfied,
    mutationResponsiveness,
    retentionScore,
    refineIntentMatched,
    resetCleanliness,
    picks: picks.map((p) => ({
      phoneId: p.phoneId,
      slug: p.slug,
      brand: p.brand,
      model: p.model,
      score: p.score,
      msrpUsd: p.msrpUsd,
    })),
    activeRequirements: req,
    ndcg3,
  };
}

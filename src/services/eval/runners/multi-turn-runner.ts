/**
 * Multi-Turn Conversational Recommender (CRS) Evaluation Runner.
 *
 * Simulates and evaluates stateful user conversations across turns:
 *   - Joint Goal Accuracy (JGA)
 *   - Constraint Retention Rate (CRR) & Anti-Forgetting
 *   - Immediate constraint mutation responsiveness on annotated eligible turns
 *   - Refine vs Expand Scope Fidelity
 *   - Clean Hard Reset Purge
 *   - Turn-by-turn self-derived MAUT agreement
 *   - Provider-reported token usage when complete
 */
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import type { AppDb } from '@/services/db/client';
import { recommendationTurns } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import { loadRecommendationCatalog } from '@/services/recommender/catalog';
import { runRecommendationPipeline } from '@/services/recommender/run-recommendation';
import { insertRecommendationSession, nextTurnIndex } from '@/services/recommender/session';
import { evaluateTurnDialogState } from '../metrics/dialog-state';
import { computeStatisticalSummary } from '../metrics/statistics';
import type {
  BenchmarkResultItem,
  BenchmarkRunMetricsSummary,
  MultiTurnTrajectoryFixture,
  TrajectoryEvaluationResult,
  TurnEvaluationResult,
} from '../types';

export interface MultiTurnRunnerOptions {
  readonly db: AppDb;
  readonly llm: LlmProvider;
  readonly fixtures: readonly MultiTurnTrajectoryFixture[];
  readonly onProgress?: (step: number, total: number, activeName: string) => void;
}

export interface MultiTurnRunnerOutput {
  readonly summary: BenchmarkRunMetricsSummary;
  readonly results: readonly BenchmarkResultItem[];
  readonly totalDurationMs: number;
}

const silentLog = pino({ level: 'silent' });

/** A mutation is only scored on an annotated turn that actually changes a prior constraint. */
export function immediateMutationResponsiveness(
  turnResults: readonly Pick<TurnEvaluationResult, 'mutationEligible' | 'mutationResponsiveness'>[],
): number | null {
  const eligible = turnResults.filter((turn) => turn.mutationEligible);
  return eligible.length
    ? eligible.filter((turn) => turn.mutationResponsiveness).length / eligible.length
    : null;
}

export async function runMultiTurnCrsBenchmark(
  options: MultiTurnRunnerOptions,
): Promise<MultiTurnRunnerOutput> {
  const { db, llm, fixtures, onProgress } = options;
  const startTime = performance.now();
  const catalog = await loadRecommendationCatalog(db, 'US');

  const trajectoryResults: TrajectoryEvaluationResult[] = [];
  const benchmarkResultItems: BenchmarkResultItem[] = [];

  const allJgaScores: number[] = [];
  const allSlotAccScores: number[] = [];
  const allCrrScores: number[] = [];
  const allTurnNdcgScores: number[] = [];

  let totalMutations = 0;
  let successfulMutations = 0;
  let totalRefineTp = 0;
  let totalRefineFp = 0;
  let totalRefineFn = 0;
  let totalRefineTn = 0;
  let totalResets = 0;
  let successfulResets = 0;
  let totalTurnsCount = 0;
  let totalTurnsCsrPassed = 0;

  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let usageCoveredTurns = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const fixture = fixtures[i]!;
    onProgress?.(i + 1, fixtures.length, fixture.name);

    const trajStartTime = performance.now();
    const sessionCookie = `eval-crs-${randomUUID()}`;
    const session = await insertRecommendationSession(db, {
      sessionCookie,
      ipHash: 'eval-runner',
      userAgent: 'RECSY-Eval-CRS-Suite',
    });

    const turnResults: TurnEvaluationResult[] = [];
    let trajHardViolations = 0;
    let trajTokensIn = 0;
    let trajTokensOut = 0;
    let trajUsageCoveredTurns = 0;
    let trajRefineTp = 0;
    let trajRefineFp = 0;
    let trajRefineFn = 0;
    let trajRefineTn = 0;

    for (const turn of fixture.turns) {
      totalTurnsCount++;
      const t0 = performance.now();

      const pipelineResult = await runRecommendationPipeline({
        db,
        llm,
        sessionId: session.id,
        userMessage: turn.userMessage,
        regionCode: 'US',
        log: silentLog,
      });

      const latencyMs = Math.round(performance.now() - t0);
      const turnIndex = await nextTurnIndex(db, session.id);

      // Count only provider-reported usage. The current pipeline does not expose it.
      if (llm.name !== 'deterministic-mock-llm' && pipelineResult.usage) {
        usageCoveredTurns++;
        trajUsageCoveredTurns++;
        trajTokensIn += pipelineResult.usage.tokensIn;
        trajTokensOut += pipelineResult.usage.tokensOut;
      }

      // Persist turn to ensure stateful continuation for subsequent turns
      if (pipelineResult.kind === 'clarify') {
        await db.insert(recommendationTurns).values({
          sessionId: session.id,
          turnIndex,
          userMessage: turn.userMessage,
          intent: 'clarify',
          extractedRequirements: pipelineResult.requirements as unknown as Record<string, unknown>,
          clarifyingQuestion: pipelineResult.clarifyingQuestion,
          latencyMs,
        });
      } else {
        await db.insert(recommendationTurns).values({
          sessionId: session.id,
          turnIndex,
          userMessage: turn.userMessage,
          intent: 'recommend',
          extractedRequirements: pipelineResult.requirements as unknown as Record<string, unknown>,
          candidatePhoneIds: pipelineResult.picks.map((p) => p.phoneId),
          picks: pipelineResult.picks as unknown[],
          latencyMs,
        });
      }

      // Evaluate turn against multi-turn DST criteria
      const evaluatedTurn = evaluateTurnDialogState({
        turn,
        result: pipelineResult,
        priorTurnResults: turnResults,
        catalog,
        latencyMs,
      });

      turnResults.push(evaluatedTurn);

      if (evaluatedTurn.hardConstraintSatisfied) {
        totalTurnsCsrPassed++;
      } else {
        trajHardViolations++;
      }

      if (turn.expectRefineIntent !== undefined) {
        const expectedRefine = turn.expectRefineIntent === true;
        const actualRefine = pipelineResult.kind === 'results' && pipelineResult.refined === true;

        if (expectedRefine && actualRefine) {
          trajRefineTp++;
          totalRefineTp++;
        } else if (!expectedRefine && actualRefine) {
          trajRefineFp++;
          totalRefineFp++;
        } else if (expectedRefine && !actualRefine) {
          trajRefineFn++;
          totalRefineFn++;
        } else {
          trajRefineTn++;
          totalRefineTn++;
        }
      }

      if (evaluatedTurn.mutationEligible) {
        totalMutations++;
        if (evaluatedTurn.mutationResponsiveness) successfulMutations++;
      }

      if (turn.isReset) {
        totalResets++;
        if (evaluatedTurn.resetCleanliness === 1.0 && evaluatedTurn.hardConstraintSatisfied) {
          successfulResets++;
        }
      }

      if (evaluatedTurn.ndcg3 != null) {
        allTurnNdcgScores.push(evaluatedTurn.ndcg3);
      }
    }

    totalTokensIn += trajTokensIn;
    totalTokensOut += trajTokensOut;

    const trajDurationMs = Math.round(performance.now() - trajStartTime);
    const avgJga = turnResults.reduce((a, b) => a + b.jgaScore, 0) / turnResults.length;
    const avgSlotAcc =
      turnResults.reduce((a, b) => a + (b.slotAccuracy ?? b.jgaScore), 0) / turnResults.length;

    // Constraint Retention Rate: calculated strictly over turns with prior retention checks
    const retentionTurns = turnResults.filter((t) => t.isRetentionTurn);
    const avgCrr =
      retentionTurns.length > 0
        ? retentionTurns.reduce((a, b) => a + b.retentionScore, 0) / retentionTurns.length
        : null;

    allJgaScores.push(avgJga);
    allSlotAccScores.push(avgSlotAcc);
    if (avgCrr !== null) {
      allCrrScores.push(avgCrr);
    }

    const trajMutationResponsiveness = immediateMutationResponsiveness(turnResults);
    const trajRefineChecks = trajRefineTp + trajRefineFp + trajRefineFn + trajRefineTn;
    const trajRefineAcc =
      trajRefineChecks > 0 ? (trajRefineTp + trajRefineTn) / trajRefineChecks : null;

    // True Harmonic Mean F1 for Refine Intent
    const trajP =
      trajRefineTp + trajRefineFp > 0 ? trajRefineTp / (trajRefineTp + trajRefineFp) : 0;
    const trajR =
      trajRefineTp + trajRefineFn > 0 ? trajRefineTp / (trajRefineTp + trajRefineFn) : 0;
    const trajRefineF1 =
      trajRefineChecks === 0 || trajRefineTp + trajRefineFn === 0
        ? null
        : trajP + trajR > 0
          ? (2 * trajP * trajR) / (trajP + trajR)
          : 0.0;

    const resetTurns = turnResults.filter((t) => t.resetCleanliness !== undefined);
    const trajResetClean =
      resetTurns.length > 0
        ? resetTurns.reduce((a, b) => a + (b.resetCleanliness ?? 0), 0) / resetTurns.length
        : null;

    const isPass = avgJga >= 0.85 && trajHardViolations === 0;
    const isWarn = avgJga >= 0.7 && trajHardViolations === 0;

    const trajResult: TrajectoryEvaluationResult = {
      trajectoryId: fixture.id,
      name: fixture.name,
      category: fixture.category,
      status: isPass ? 'pass' : isWarn ? 'warn' : 'fail',
      turnResults,
      overallJga: Math.round(avgJga * 1000) / 1000,
      overallSlotAccuracy: Math.round(avgSlotAcc * 1000) / 1000,
      overallRetentionRate: avgCrr !== null ? Math.round(avgCrr * 1000) / 1000 : null,
      overallMutationResponsiveness:
        trajMutationResponsiveness !== null
          ? Math.round(trajMutationResponsiveness * 1000) / 1000
          : null,
      refineIntentAccuracy: trajRefineAcc !== null ? Math.round(trajRefineAcc * 1000) / 1000 : null,
      refineIntentF1: trajRefineF1 !== null ? Math.round(trajRefineF1 * 1000) / 1000 : null,
      resetCleanliness: trajResetClean !== null ? Math.round(trajResetClean * 1000) / 1000 : null,
      ...(trajUsageCoveredTurns === fixture.turns.length
        ? {
            tokenUsage: {
              tokensIn: trajTokensIn,
              tokensOut: trajTokensOut,
              isMeasured: true,
            },
          }
        : {}),
      durationMs: trajDurationMs,
    };

    trajectoryResults.push(trajResult);

    benchmarkResultItems.push({
      id: fixture.id,
      runId: '',
      testCaseId: fixture.id,
      category: 'multi-turn',
      inputQuery: `${fixture.name}: ${fixture.turns[0]?.userMessage ?? ''} (${fixture.turns.length} turns)`,
      status: trajResult.status,
      latencyMs: trajDurationMs,
      scores: {
        jga: trajResult.overallJga,
        slotAccuracy: trajResult.overallSlotAccuracy ?? null,
        crr: trajResult.overallRetentionRate,
        mutationResponsiveness: trajResult.overallMutationResponsiveness,
        refineF1: trajResult.refineIntentF1,
        refineAccuracy: trajResult.refineIntentAccuracy,
        csr: trajHardViolations === 0 ? 1 : 0,
      },
      tracePayload: {
        multiTurnTrajectory: {
          turns: turnResults,
          jga: trajResult.overallJga,
          crr: trajResult.overallRetentionRate,
          refineF1: trajResult.refineIntentF1,
          resetCleanliness: trajResult.resetCleanliness,
          ...(trajResult.tokenUsage
            ? {
                tokensIn: trajResult.tokenUsage.tokensIn,
                tokensOut: trajResult.tokenUsage.tokensOut,
              }
            : {}),
        },
      },
      createdAt: new Date(),
    });
  }

  const totalDurationMs = Math.round(performance.now() - startTime);

  const jgaSummary = computeStatisticalSummary(allJgaScores);
  const slotAccSummary = computeStatisticalSummary(allSlotAccScores);
  const crrSummary = computeStatisticalSummary(allCrrScores);
  const turnNdcgSummary = computeStatisticalSummary(allTurnNdcgScores);

  const mutationResponsiveness =
    totalMutations > 0
      ? Math.round((successfulMutations / totalMutations) * 1000) / 1000
      : undefined;

  // Global Refine Intent F1 & Accuracy
  const totalRefineDecisions = totalRefineTp + totalRefineFp + totalRefineFn + totalRefineTn;
  const globalP =
    totalRefineTp + totalRefineFp > 0 ? totalRefineTp / (totalRefineTp + totalRefineFp) : 0;
  const globalR =
    totalRefineTp + totalRefineFn > 0 ? totalRefineTp / (totalRefineTp + totalRefineFn) : 0;
  const refineIntentF1 =
    totalRefineDecisions === 0 || totalRefineTp + totalRefineFn === 0
      ? null
      : globalP + globalR > 0
        ? Math.round(((2 * globalP * globalR) / (globalP + globalR)) * 1000) / 1000
        : 0.0;

  const resetCleanliness =
    totalResets > 0 ? Math.round((successfulResets / totalResets) * 1000) / 1000 : undefined;
  const multiTurnCsr =
    totalTurnsCount > 0 ? Math.round((totalTurnsCsrPassed / totalTurnsCount) * 1000) / 1000 : 1.0;

  const passedTests = benchmarkResultItems.filter((r) => r.status === 'pass').length;
  const failedTests = benchmarkResultItems.filter((r) => r.status !== 'pass').length;

  return {
    summary: {
      jointGoalAccuracy: jgaSummary,
      slotAccuracy: slotAccSummary,
      constraintRetentionRate: crrSummary,
      ...(mutationResponsiveness != null ? { mutationResponsiveness } : {}),
      ...(refineIntentF1 !== null ? { refineIntentF1 } : {}),
      ...(resetCleanliness != null ? { resetCleanliness } : {}),
      multiTurnCsr,
      meanTurnNdcg3: turnNdcgSummary,
      totalTests: benchmarkResultItems.length,
      passedTests,
      failedTests,
      ...(usageCoveredTurns === totalTurnsCount
        ? {
            tokenUsage: {
              tokensIn: totalTokensIn,
              tokensOut: totalTokensOut,
              totalTokens: totalTokensIn + totalTokensOut,
            },
          }
        : {}),
    },
    results: benchmarkResultItems,
    totalDurationMs,
  };
}

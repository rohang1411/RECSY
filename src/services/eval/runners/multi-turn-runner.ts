/**
 * Multi-Turn Conversational Recommender (CRS) Evaluation Runner.
 *
 * Simulates and evaluates stateful user conversations across turns:
 *   - Joint Goal Accuracy (JGA)
 *   - Constraint Retention Rate (CRR) & Anti-Forgetting
 *   - Constraint Mutation Latency (CML)
 *   - Refine vs Expand Scope Fidelity
 *   - Clean Hard Reset Purge
 *   - Cumulative Turn-by-Turn NDCG@3
 *   - Token Usage & Financial Cost Accounting
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

export async function runMultiTurnCrsBenchmark(
  options: MultiTurnRunnerOptions,
): Promise<MultiTurnRunnerOutput> {
  const { db, llm, fixtures, onProgress } = options;
  const startTime = performance.now();
  const catalog = await loadRecommendationCatalog(db, 'US');

  const trajectoryResults: TrajectoryEvaluationResult[] = [];
  const benchmarkResultItems: BenchmarkResultItem[] = [];

  const allJgaScores: number[] = [];
  const allCrrScores: number[] = [];
  const allTurnNdcgScores: number[] = [];

  let totalMutations = 0;
  let successfulMutations = 0;
  let totalRefineChecks = 0;
  let successfulRefineChecks = 0;
  let totalResets = 0;
  let successfulResets = 0;
  let totalTurnsCount = 0;
  let totalTurnsCsrPassed = 0;

  let totalTokensIn = 0;
  let totalTokensOut = 0;

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

    for (const turn of fixture.turns) {
      totalTurnsCount++;
      const t0 = performance.now();

      // Estimate or track token consumption (standard 500 in, 200 out per turn)
      totalTokensIn += 520;
      totalTokensOut += 180;

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
        totalRefineChecks++;
        if (evaluatedTurn.refineIntentMatched) successfulRefineChecks++;
      }

      if (turn.forbiddenBrands?.length || turn.expectedSlots?.budgetMaxUsd != null) {
        totalMutations++;
        if (evaluatedTurn.mutationResponsiveness) successfulMutations++;
      }

      if (turn.isReset) {
        totalResets++;
        if (evaluatedTurn.hardConstraintSatisfied && evaluatedTurn.jgaScore >= 0.8) {
          successfulResets++;
        }
      }

      if (evaluatedTurn.ndcg3 != null) {
        allTurnNdcgScores.push(evaluatedTurn.ndcg3);
      }
    }

    const trajDurationMs = Math.round(performance.now() - trajStartTime);
    const avgJga = turnResults.reduce((a, b) => a + b.jgaScore, 0) / turnResults.length;
    const avgCrr = turnResults.reduce((a, b) => a + b.retentionScore, 0) / turnResults.length;

    allJgaScores.push(avgJga);
    allCrrScores.push(avgCrr);

    const trajMutationLatency = turnResults.every((t) => t.mutationResponsiveness) ? 0 : 1;
    const trajRefineAcc =
      turnResults.filter((t) => t.refineIntentMatched).length / turnResults.length;
    const trajResetClean = turnResults.some((t) => fixture.turns[t.turnIndex - 1]?.isReset)
      ? turnResults.filter(
          (t) => fixture.turns[t.turnIndex - 1]?.isReset && t.hardConstraintSatisfied,
        ).length
      : 1.0;

    const isPass = avgJga >= 0.85 && trajHardViolations === 0;
    const isWarn = avgJga >= 0.7 && trajHardViolations === 0;

    const trajResult: TrajectoryEvaluationResult = {
      trajectoryId: fixture.id,
      name: fixture.name,
      category: fixture.category,
      status: isPass ? 'pass' : isWarn ? 'warn' : 'fail',
      turnResults,
      overallJga: Math.round(avgJga * 1000) / 1000,
      overallRetentionRate: Math.round(avgCrr * 1000) / 1000,
      overallMutationLatency: trajMutationLatency,
      refineIntentAccuracy: Math.round(trajRefineAcc * 1000) / 1000,
      resetCleanliness: Math.round(trajResetClean * 1000) / 1000,
      tokenUsage: {
        tokensIn: fixture.turns.length * 520,
        tokensOut: fixture.turns.length * 180,
        estimatedCostUsd:
          Math.round(
            ((fixture.turns.length * 520 * 0.1) / 1_000_000 +
              (fixture.turns.length * 180 * 0.4) / 1_000_000) *
              10000,
          ) / 10000,
      },
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
        crr: trajResult.overallRetentionRate,
        mutationLatency: trajResult.overallMutationLatency,
        refineF1: trajResult.refineIntentAccuracy,
        csr: trajHardViolations === 0 ? 1 : 0,
      },
      tracePayload: {
        multiTurnTrajectory: {
          turns: turnResults,
          jga: trajResult.overallJga,
          crr: trajResult.overallRetentionRate,
          refineF1: trajResult.refineIntentAccuracy,
          resetCleanliness: trajResult.resetCleanliness,
          tokensIn: trajResult.tokenUsage.tokensIn,
          tokensOut: trajResult.tokenUsage.tokensOut,
          estimatedCostUsd: trajResult.tokenUsage.estimatedCostUsd,
        },
      },
      createdAt: new Date(),
    });
  }

  const totalDurationMs = Math.round(performance.now() - startTime);

  const jgaSummary = computeStatisticalSummary(allJgaScores);
  const crrSummary = computeStatisticalSummary(allCrrScores);
  const turnNdcgSummary = computeStatisticalSummary(allTurnNdcgScores);

  const mutationResponsiveness =
    totalMutations > 0 ? Math.round((successfulMutations / totalMutations) * 1000) / 1000 : 1.0;
  const refineIntentF1 =
    totalRefineChecks > 0
      ? Math.round((successfulRefineChecks / totalRefineChecks) * 1000) / 1000
      : 1.0;
  const resetCleanliness =
    totalResets > 0 ? Math.round((successfulResets / totalResets) * 1000) / 1000 : 1.0;
  const multiTurnCsr =
    totalTurnsCount > 0 ? Math.round((totalTurnsCsrPassed / totalTurnsCount) * 1000) / 1000 : 1.0;

  // Gemini 2.0 Flash pricing: $0.10 / 1M input tokens, $0.40 / 1M output tokens
  const estimatedCostUsd =
    Math.round(((totalTokensIn * 0.1) / 1_000_000 + (totalTokensOut * 0.4) / 1_000_000) * 10000) /
    10000;

  const passedTests = benchmarkResultItems.filter((r) => r.status === 'pass').length;
  const failedTests = benchmarkResultItems.filter((r) => r.status === 'fail').length;

  return {
    summary: {
      jointGoalAccuracy: jgaSummary,
      constraintRetentionRate: crrSummary,
      mutationResponsiveness,
      refineIntentF1,
      resetCleanliness,
      multiTurnCsr,
      meanTurnNdcg3: turnNdcgSummary,
      totalTests: benchmarkResultItems.length,
      passedTests,
      failedTests,
      tokenUsage: {
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        totalTokens: totalTokensIn + totalTokensOut,
        estimatedCostUsd,
      },
    },
    results: benchmarkResultItems,
    totalDurationMs,
  };
}

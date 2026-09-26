#!/usr/bin/env tsx
/**
 * CLI Evaluation Benchmark Runner: `pnpm eval:benchmark`.
 *
 * Runs offline Recommender ranking and Stanford ALCE attribution benchmarks,
 * printing rigorous statistical summaries (NDCG, ILD, CSR, CitePrec, CI95) to terminal.
 */
import { getDb } from '@/services/db/client';
import { executeBenchmarkSuite } from '@/services/eval/orchestrator';

async function main(): Promise<void> {
  console.log('\n======================================================');
  console.log('RECSY v2 — Scientific System Evaluation Benchmark');
  console.log('======================================================\n');

  const db = getDb();

  const args = process.argv.slice(2);
  const suiteArg =
    args.find((a) => a.startsWith('--suite=') || a === '--suite')?.split('=')[1] ?? 'recsys';
  const sampleArg =
    args.find((a) => a.startsWith('--sample=') || a === '--sample')?.split('=')[1] ?? 'full';

  const suite = (
    ['recsys', 'rag', 'multi-turn', 'all'].includes(suiteArg) ? suiteArg : 'recsys'
  ) as 'recsys' | 'rag' | 'multi-turn' | 'all';
  const sampleScale = (sampleArg === 'quick' ? 'quick' : 'full') as 'quick' | 'full';

  const tier =
    suite === 'rag'
      ? 'RAG_ALCE'
      : suite === 'multi-turn'
        ? 'MULTI_TURN_CRS'
        : suite === 'all'
          ? 'L3_MACRO_LLM'
          : 'OFFLINE_RECSYS';

  console.log(`[eval:benchmark] Starting benchmark suite: "${suite}" (sample: ${sampleScale})...`);
  const run = await executeBenchmarkSuite({
    db,
    suite,
    tier,
    concurrencyVus: 1,
    sampleScale,
    onProgress: (p) => {
      process.stdout.write(
        `\r[eval:benchmark] [${p.currentStep}/${p.totalSteps}] ${p.activeTest.padEnd(60)}`,
      );
    },
  });

  console.log('\n\n------------------------------------------------------');
  console.log('PRIMARY EVALUATION RESULTS (95% Bootstrap CIs):');
  console.log('------------------------------------------------------');
  const m = run.metricsSummary;

  if (m?.ndcg3) {
    console.log(
      `Recommender NDCG@3:    ${m.ndcg3.mean.toFixed(3)} ± ${((m.ndcg3.ci95[1] - m.ndcg3.ci95[0]) / 2).toFixed(3)}  (CI95: [${m.ndcg3.ci95[0]}, ${m.ndcg3.ci95[1]}])`,
    );
  }
  if (m?.mrr != null) {
    console.log(`Mean Reciprocal Rank:  ${m.mrr.toFixed(3)}`);
  }
  if (m?.ild3) {
    console.log(
      `Intra-List Div (ILD):  ${m.ild3.mean.toFixed(3)} ± ${((m.ild3.ci95[1] - m.ild3.ci95[0]) / 2).toFixed(3)}`,
    );
  }
  if (m?.catalogCoverage != null) {
    console.log(`Catalog Coverage:      ${(m.catalogCoverage * 100).toFixed(1)}%`);
  }
  if (m?.giniCoefficient != null) {
    console.log(`Catalog Gini Index:    ${m.giniCoefficient.toFixed(3)}  (Target: <= 0.380)`);
  }
  if (m?.budgetCsr != null) {
    console.log(`Budget Policy CSR:     ${(m.budgetCsr * 100).toFixed(1)}%  (Zero Tolerance)`);
  }
  if (m?.dealbreakerCsr != null) {
    console.log(`Dealbreaker Leakage:   ${((1 - m.dealbreakerCsr) * 100).toFixed(2)}%`);
  }

  // RAG / ALCE Attribution Metrics
  if (m?.citePrec) {
    console.log(
      `Citation Precision:    ${(m.citePrec.mean * 100).toFixed(1)}% ± ${(((m.citePrec.ci95[1] - m.citePrec.ci95[0]) / 2) * 100).toFixed(1)}% (CI95: [${m.citePrec.ci95[0]}, ${m.citePrec.ci95[1]}])`,
    );
  }
  if (m?.citeRec) {
    console.log(
      `Citation Recall:       ${(m.citeRec.mean * 100).toFixed(1)}% ± ${(((m.citeRec.ci95[1] - m.citeRec.ci95[0]) / 2) * 100).toFixed(1)}%`,
    );
  }
  if (m?.phantomRate != null) {
    console.log(`Phantom Citation Rate: ${(m.phantomRate * 100).toFixed(2)}%  (Target: 0.00%)`);
  }

  // Multi-Turn Conversational Recommender (CRS) Metrics
  if (m?.jointGoalAccuracy) {
    console.log(
      `Joint Goal Acc (JGA):  ${(m.jointGoalAccuracy.mean * 100).toFixed(1)}% ± ${(((m.jointGoalAccuracy.ci95[1] - m.jointGoalAccuracy.ci95[0]) / 2) * 100).toFixed(1)}% (CI95: [${m.jointGoalAccuracy.ci95[0]}, ${m.jointGoalAccuracy.ci95[1]}])`,
    );
  }
  if (m?.constraintRetentionRate) {
    console.log(
      `Constraint Retention:  ${(m.constraintRetentionRate.mean * 100).toFixed(1)}% ± ${(((m.constraintRetentionRate.ci95[1] - m.constraintRetentionRate.ci95[0]) / 2) * 100).toFixed(1)}%`,
    );
  }
  if (m?.mutationResponsiveness != null) {
    console.log(
      `Mutation Response Rate:${(m.mutationResponsiveness * 100).toFixed(1)}%  (0-Turn Latency)`,
    );
  }
  if (m?.refineIntentF1 != null) {
    console.log(`Refine Intent Accuracy:${(m.refineIntentF1 * 100).toFixed(1)}%`);
  }
  if (m?.resetCleanliness != null) {
    console.log(`Reset Purge Clean:     ${(m.resetCleanliness * 100).toFixed(1)}%`);
  }
  if (m?.multiTurnCsr != null) {
    console.log(`Multi-Turn Policy CSR: ${(m.multiTurnCsr * 100).toFixed(1)}%  (Zero Tolerance)`);
  }
  if (m?.tokenUsage) {
    console.log(
      `Token Accounting:      ${m.tokenUsage.tokensIn.toLocaleString()} tokens in / ${m.tokenUsage.tokensOut.toLocaleString()} out (Est Cost: $${m.tokenUsage.estimatedCostUsd.toFixed(4)})`,
    );
  }

  console.log(
    `\nTests: ${run.passedTests} passed, ${run.failedTests} failed, total ${run.totalTests}`,
  );
  console.log(`Duration: ${(run.durationMs / 1000).toFixed(2)}s | Benchmark Run ID: ${run.id}\n`);

  const nonPassing = run.results?.filter((r) => r.status !== 'pass') ?? [];
  if (nonPassing.length > 0) {
    console.log('--- Non-passing test cases: ---');
    for (const r of nonPassing) {
      let scoreStr = '';
      if (r.category === 'recsys') {
        scoreStr = `NDCG@3=${r.scores?.ndcg3?.toFixed(3)}`;
      } else if (r.category === 'rag') {
        scoreStr = `CitePrec=${r.scores?.citePrec?.toFixed(3)}, CiteRec=${r.scores?.citeRec?.toFixed(3)}`;
      } else if (r.category === 'multi-turn') {
        scoreStr = `JGA=${r.scores?.jga != null ? (r.scores.jga * 100).toFixed(0) : '--'}%, CRR=${r.scores?.crr != null ? (r.scores.crr * 100).toFixed(0) : '--'}%`;
      }
      console.log(
        `[${r.status.toUpperCase()}] ${r.testCaseId}: ${scoreStr}, query="${r.inputQuery}"`,
      );
    }
    console.log('-------------------------------\n');
  }

  process.exit(run.failedTests > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\n[eval:benchmark] FAILED with error:', err);
  process.exit(1);
});

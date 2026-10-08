#!/usr/bin/env tsx
/**
 * CLI Evaluation Benchmark Runner: `pnpm eval:benchmark`.
 *
 * Runs bounded component evaluations and prints their measured, labeled summaries.
 */
import { getDb } from '@/services/db/client';
import { executeBenchmarkSuite } from '@/services/eval/orchestrator';

async function main(): Promise<void> {
  console.log('\n======================================================');
  console.log('RECSY v2 — Evaluation Runner');
  console.log('======================================================\n');

  const db = getDb();

  const args = process.argv.slice(2);
  const suiteArg = args.find((a) => a.startsWith('--suite='))?.split('=')[1] ?? 'recsys';
  const sampleArg = args.find((a) => a.startsWith('--sample='))?.split('=')[1] ?? 'full';
  const trackArg = args.find((a) => a.startsWith('--track='))?.split('=')[1] ?? 'stub';
  const vusArg = args.find((a) => a.startsWith('--vus='))?.split('=')[1];
  const totalArg = args.find((a) => a.startsWith('--total='))?.split('=')[1];
  if (!['recsys', 'rag', 'multi-turn', 'all', 'load-stress'].includes(suiteArg))
    throw new Error(`Unknown suite: ${suiteArg}`);
  if (!['quick', 'full'].includes(sampleArg)) throw new Error(`Unknown sample: ${sampleArg}`);
  if (!['stub', 'live'].includes(trackArg)) throw new Error(`Unknown track: ${trackArg}`);
  const concurrencyVus = vusArg == null ? 1 : Number(vusArg);
  const totalRequests = totalArg == null ? undefined : Number(totalArg);
  if (!Number.isInteger(concurrencyVus) || concurrencyVus < 1 || concurrencyVus > 100)
    throw new Error('--vus must be an integer from 1 to 100');
  if (
    totalRequests !== undefined &&
    (!Number.isInteger(totalRequests) || totalRequests < 1 || totalRequests > 10000)
  )
    throw new Error('--total must be an integer from 1 to 10000');

  const suite = suiteArg as 'recsys' | 'rag' | 'multi-turn' | 'all' | 'load-stress';
  const sampleScale = (sampleArg === 'quick' ? 'quick' : 'full') as 'quick' | 'full';

  console.log(
    `[eval:benchmark] Suite=${suite} sample=${sampleScale} provider=${trackArg}. Stub results are development checks, not live-model evidence.`,
  );
  const run = await executeBenchmarkSuite({
    db,
    suite,
    providerTrack: trackArg as 'stub' | 'live',
    concurrencyVus,
    totalRequests,
    sampleScale,
    onProgress: (p) => {
      process.stdout.write(
        `\r[eval:benchmark] [${p.currentStep}/${p.totalSteps}] ${p.activeTest.padEnd(60)}`,
      );
    },
  });

  console.log('\n\n------------------------------------------------------');
  console.log('COMPONENT RESULTS (development fixtures; not product quality):');
  console.log('------------------------------------------------------');
  const m = run.metricsSummary;

  if (m?.ndcg3) {
    console.log(
      `Ranker MAUT agreement NDCG@3: ${m.ndcg3.mean.toFixed(3)} (n=${m.ndcg3.sampleSize}; self-derived labels)`,
    );
  }
  if (m?.mrr != null) {
    console.log(`Self-derived MAUT MRR: ${m.mrr.toFixed(3)}`);
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
    console.log(`Catalog Gini Index:    ${m.giniCoefficient.toFixed(3)}`);
  }
  if (m?.budgetCsr != null) {
    console.log(
      `Budget Policy Checks:  ${(m.budgetCsr * 100).toFixed(1)}% (n=${m.constraintPolicyCases ?? 'unrecorded'})`,
    );
  }
  if (m?.dealbreakerCsr != null) {
    console.log(
      `Dealbreaker/answerable-empty checks: ${(m.dealbreakerCsr * 100).toFixed(1)}% (n=${m.constraintPolicyCases ?? 'unrecorded'})`,
    );
  }
  if (m?.noResultPolicyCases) {
    console.log(
      `Expected no-result policy: ${m.noResultPolicyPassed ?? 0}/${m.noResultPolicyCases} cases`,
    );
  }

  // Q&A mechanical citation proxies
  if (m?.citePrec) {
    console.log(
      `Lexical citation support proxy: ${(m.citePrec.mean * 100).toFixed(1)}% (n=${m.citePrec.sampleSize}; not semantic entailment)`,
    );
  }
  if (m?.citeRec) {
    console.log(
      `Lexical sentence coverage: ${(m.citeRec.mean * 100).toFixed(1)}% (n=${m.citeRec.sampleSize})`,
    );
  }
  if (m?.phantomRate != null) {
    console.log(`Unknown citation-ID rate: ${(m.phantomRate * 100).toFixed(2)}%`);
  }
  if (m?.retrievalObservedCases != null) {
    console.log(
      `Q&A retrieval signals: FTS zero in ${m.ftsZeroCases ?? 'unrecorded'}/${m.retrievalObservedCases}; vector zero in ${m.vectorZeroCases ?? 'unrecorded'}/${m.retrievalObservedCases} cases`,
    );
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
      `Immediate mutation response: ${(m.mutationResponsiveness * 100).toFixed(1)}% of eligible annotated turns`,
    );
  }
  if (m?.refineIntentF1 != null) {
    console.log(`Refine Intent F1:      ${(m.refineIntentF1 * 100).toFixed(1)}%`);
  }
  if (m?.resetCleanliness != null) {
    console.log(`Reset Purge Clean:     ${(m.resetCleanliness * 100).toFixed(1)}%`);
  }
  if (m?.multiTurnCsr != null) {
    console.log(`Multi-Turn Policy Checks: ${(m.multiTurnCsr * 100).toFixed(1)}%`);
  }
  if (m?.tokenUsage) {
    console.log(
      `Uncached provider-reported generation tokens: ${m.tokenUsage.tokensIn.toLocaleString()} in / ${m.tokenUsage.tokensOut.toLocaleString()} out`,
    );
  }
  if (m?.generationProviderCalls != null) {
    console.log(
      `Generation calls: ${m.generationProviderCalls} uncached, ${m.generationCacheHits ?? 0} cache hits; usage reported for ${m.generationUsageCoveredCalls ?? 0}/${m.generationProviderCalls} uncached calls`,
    );
  }
  if (m?.goodputQps != null) {
    console.log(
      `DB retrieval probe: ${run.passedTests}/${run.totalTests} successful attempts at ${run.concurrencyVus} workers; goodput ${m.goodputQps}/s; p95 ${m.latencyP95}ms; stage p95 ${JSON.stringify(m.stageP95Ms ?? {})}`,
    );
  }

  console.log(
    `\nTests: ${run.passedTests} passed, ${run.failedTests} failed, total ${run.totalTests}`,
  );
  console.log(`Duration: ${(run.durationMs / 1000).toFixed(2)}s | Benchmark Run ID: ${run.id}\n`);
  console.log(
    `Run status: ${run.status}; commit: ${run.commitHash ?? 'unavailable'}; provider: ${String(run.config?.provider ?? 'unavailable')}`,
  );

  const nonPassing = run.results?.filter((r) => r.status !== 'pass') ?? [];
  if (nonPassing.length > 0) {
    console.log('--- Non-passing test cases: ---');
    for (const r of nonPassing) {
      let scoreStr = '';
      if (r.category === 'recsys') {
        scoreStr = `MAUT agreement NDCG@3=${r.scores?.ndcg3?.toFixed(3) ?? 'unavailable'}`;
      } else if (r.category === 'rag') {
        scoreStr = `lexicalSupport=${r.scores?.citePrec?.toFixed(3)}, sentenceCoverage=${r.scores?.citeRec?.toFixed(3)}`;
      } else if (r.category === 'multi-turn') {
        scoreStr = `JGA=${r.scores?.jga != null ? (r.scores.jga * 100).toFixed(0) : '--'}%, CRR=${r.scores?.crr != null ? (r.scores.crr * 100).toFixed(0) : '--'}%`;
      }
      console.log(
        `[${r.status.toUpperCase()}] ${r.testCaseId}: ${scoreStr}, query="${r.inputQuery}"${r.errorDetails ? `, error=${r.errorDetails}` : ''}`,
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

/**
 * Grounded Q&A Evaluation Runner (Stanford ALCE & Citation Attribution).
 *
 * Runs retrieval and generation on phone-scoped review corpuses,
 * evaluating Sentence-Level Citation Precision (CitePrec), Citation Recall (CiteRec),
 * and Zero-Tolerance Phantom Citation Rates.
 */
import { eq } from 'drizzle-orm';
import pino from 'pino';
import type { AppDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { runPhoneQna } from '@/services/chat/answer';
import { evaluateAlceAttribution } from '../metrics/alce';
import { evaluateFullySupportedAnswer } from '../metrics/supported-answers';
import { computeStatisticalSummary } from '../metrics/statistics';
import type {
  AttributedQaFixture,
  BenchmarkResultItem,
  BenchmarkRunMetricsSummary,
} from '../types';

export interface RagRunnerOptions {
  readonly db: AppDb;
  readonly llm: LlmProvider;
  readonly fixtures: readonly AttributedQaFixture[];
  readonly onProgress?: (step: number, total: number, currentItem: string) => void;
}

export interface RagRunnerOutput {
  readonly summary: BenchmarkRunMetricsSummary;
  readonly results: readonly BenchmarkResultItem[];
  readonly totalDurationMs: number;
}

export async function runRagAlceBenchmark(options: RagRunnerOptions): Promise<RagRunnerOutput> {
  const { db, llm, fixtures, onProgress } = options;
  const startTime = performance.now();
  const retriever = createHybridRetriever({ llm });

  const results: BenchmarkResultItem[] = [];
  const citePrecScores: number[] = [];
  const citeRecScores: number[] = [];
  const fsarScores: number[] = [];
  const claimSupportPrecScores: number[] = [];
  const factualRecallScores: number[] = [];
  let totalPhantomCitations = 0;
  let totalAllCitations = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;

  let step = 0;
  const total = fixtures.length;

  for (const fixture of fixtures) {
    step++;
    onProgress?.(step, total, `${fixture.phoneSlug}: ${fixture.query}`);

    const t0 = performance.now();

    // Look up target phone
    const [phone] = await db
      .select({ id: phones.id, slug: phones.slug, brand: phones.brand, model: phones.model })
      .from(phones)
      .where(eq(phones.slug, fixture.phoneSlug))
      .limit(1);

    if (!phone) {
      results.push({
        id: fixture.id,
        runId: '',
        testCaseId: fixture.id,
        category: 'rag',
        inputQuery: fixture.query,
        status: 'warn',
        latencyMs: 0,
        scores: { citePrec: 0, citeRec: 0, phantomRate: 0, fsar: 0 },
        errorDetails: `Phone with slug "${fixture.phoneSlug}" not found in database`,
        createdAt: new Date(),
      });
      continue;
    }

    try {
      // Generate answer via phone Q&A pipeline (which executes retrieval internally)
      const qnaResult = await runPhoneQna({
        phoneId: phone.id,
        query: fixture.query,
        retriever,
        llm,
        log: pino({ level: 'silent' }),
        phoneMeta: { brand: phone.brand, model: phone.model },
      });

      const latencyMs = Math.round(performance.now() - t0);

      if (qnaResult.usage) {
        totalTokensIn += qnaResult.usage.tokensIn;
        totalTokensOut += qnaResult.usage.tokensOut;
      }

      // Build chunk map directly from the actual chunks used during generation
      const chunkMap = new Map<string, string>();
      for (const c of qnaResult.retrieval.chunks) {
        chunkMap.set(c.chunkId, c.text);
      }

      // Evaluate ALCE attribution
      const alceResult = evaluateAlceAttribution(qnaResult.text, chunkMap);

      // Evaluate Fully Supported Answer Rate (FSAR)
      const supportedResult = evaluateFullySupportedAnswer({
        query: fixture.query,
        answerText: qnaResult.text,
        retrievedChunks: chunkMap,
        referenceFacts: fixture.referenceFacts,
        numericalEntities: fixture.numericalEntities,
      });

      citePrecScores.push(alceResult.citePrec);
      citeRecScores.push(alceResult.citeRec);
      fsarScores.push(supportedResult.isFullySupported ? 1.0 : 0.0);
      claimSupportPrecScores.push(supportedResult.claimSupportPrecision);
      factualRecallScores.push(supportedResult.factualRecall);

      totalPhantomCitations += alceResult.phantomRate * alceResult.totalCitations;
      totalAllCitations += alceResult.totalCitations;

      const minExpectedPrec = fixture.minExpectedCitePrec ?? 0.85;
      const isPass =
        alceResult.citePrec >= minExpectedPrec &&
        alceResult.phantomRate === 0 &&
        supportedResult.isFullySupported;
      const isWarn = alceResult.citePrec >= minExpectedPrec - 0.15 && alceResult.phantomRate === 0;

      results.push({
        id: fixture.id,
        runId: '',
        testCaseId: fixture.id,
        category: 'rag',
        inputQuery: fixture.query,
        status: isPass ? 'pass' : isWarn ? 'warn' : 'fail',
        latencyMs,
        scores: {
          citePrec: alceResult.citePrec,
          citeRec: alceResult.citeRec,
          phantomRate: alceResult.phantomRate,
          fsar: supportedResult.isFullySupported ? 1 : 0,
          claimSupportPrecision: supportedResult.claimSupportPrecision,
          factualRecall: supportedResult.factualRecall,
          retrievedChunksCount: qnaResult.retrieval.chunks.length,
          totalCitations: alceResult.totalCitations,
        },
        tracePayload: {
          retrievedChunks: qnaResult.retrieval.chunks.map((c) => ({
            chunkId: c.chunkId,
            score: c.score,
            sourceTitle: c.source.title,
            textSnippet: c.text.slice(0, 180),
          })),
          generatedText: qnaResult.text,
          citations: alceResult.sentenceAttributions.flatMap((s) => s.citations),
          violations: supportedResult.violations,
          missingNumericalEntities: supportedResult.missingEntities,
        },
        createdAt: new Date(),
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        id: fixture.id,
        runId: '',
        testCaseId: fixture.id,
        category: 'rag',
        inputQuery: fixture.query,
        status: 'fail',
        latencyMs: Math.round(performance.now() - t0),
        scores: { citePrec: 0, citeRec: 0, phantomRate: 0, fsar: 0 },
        errorDetails: errorMsg,
        createdAt: new Date(),
      });
    }
  }

  const totalDurationMs = Math.round(performance.now() - startTime);

  const citePrecSummary = computeStatisticalSummary(citePrecScores);
  const citeRecSummary = computeStatisticalSummary(citeRecScores);
  const fsarSummary = computeStatisticalSummary(fsarScores);
  const claimSupportSummary = computeStatisticalSummary(claimSupportPrecScores);
  const factualRecallSummary = computeStatisticalSummary(factualRecallScores);

  const aggregatePhantomRate =
    totalAllCitations > 0
      ? Math.round((totalPhantomCitations / totalAllCitations) * 1000) / 1000
      : 0.0;

  const passedTests = results.filter((r) => r.status === 'pass').length;
  const failedTests = results.filter((r) => r.status === 'fail').length;

  const estimatedCostUsd =
    Math.round(((totalTokensIn * 0.1) / 1_000_000 + (totalTokensOut * 0.4) / 1_000_000) * 10000) /
    10000;

  return {
    summary: {
      citePrec: citePrecSummary,
      citeRec: citeRecSummary,
      fullySupportedAnswerRate: fsarSummary,
      claimSupportPrecision: claimSupportSummary,
      factualCitationRecall: factualRecallSummary,
      phantomRate: aggregatePhantomRate,
      totalTests: results.length,
      passedTests,
      failedTests,
      tokenUsage: {
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        totalTokens: totalTokensIn + totalTokensOut,
        estimatedCostUsd,
      },
    },
    results,
    totalDurationMs,
  };
}

/**
 * Grounded Q&A development checks. Lexical proxies are not semantic ALCE scores.
 *
 * Runs retrieval and generation on phone-scoped review corpuses,
 * reporting lexical citation overlap, citation coverage, and unknown citation IDs.
 */
import { eq } from 'drizzle-orm';
import pino from 'pino';
import type { AppDb } from '@/services/db/client';
import { phones } from '@/services/db/schema';
import type { LlmProvider } from '@/services/llm/types';
import { createHybridRetriever } from '@/services/retrieval/factory';
import { runPhoneQna } from '@/services/chat/answer';
import { evaluateCitationLexicalProxy } from '../metrics/alce';
import { evaluateAnswerHeuristics } from '../metrics/supported-answers';
import { computeStatisticalSummary } from '../metrics/statistics';
import { diagnoseEvaluationError } from '../errors';
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
  let totalPhantomCitations = 0;
  let totalAllCitations = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let generationProviderCalls = 0;
  let generationCacheHits = 0;
  let generationUsageCoveredCalls = 0;
  let retrievalObservedCases = 0;
  let ftsZeroCases = 0;
  let vectorZeroCases = 0;

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
        status: 'fail',
        latencyMs: 0,
        scores: {},
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
      retrievalObservedCases++;
      if (qnaResult.retrieval.debug.fts.count === 0) ftsZeroCases++;
      if (qnaResult.retrieval.debug.vector.count === 0) vectorZeroCases++;
      const retrievalStageError = [
        qnaResult.retrieval.debug.vector.error
          ? `vector: ${qnaResult.retrieval.debug.vector.error}`
          : null,
        qnaResult.retrieval.debug.fts.error ? `fts: ${qnaResult.retrieval.debug.fts.error}` : null,
      ]
        .filter(Boolean)
        .join('; ');

      if (llm.name !== 'deterministic-mock-llm') {
        generationProviderCalls += qnaResult.generationAccounting.providerCalls;
        generationCacheHits += qnaResult.generationAccounting.cacheHits;
        generationUsageCoveredCalls += qnaResult.generationAccounting.reportedUsageCalls;
        totalTokensIn += qnaResult.generationAccounting.tokensIn;
        totalTokensOut += qnaResult.generationAccounting.tokensOut;
      }

      // Build chunk map directly from the actual chunks used during generation
      const chunkMap = new Map<string, string>();
      for (const c of qnaResult.retrieval.chunks) {
        chunkMap.set(c.chunkId, c.text);
      }

      // Reuse the historical helper for lexical checks; this is not semantic ALCE entailment.
      const alceResult = evaluateCitationLexicalProxy(qnaResult.text, chunkMap);

      // Mechanical answer-text checks; not a fully supported answer decision.
      const supportedResult = evaluateAnswerHeuristics({
        query: fixture.query,
        answerText: qnaResult.text,
        retrievedChunks: chunkMap,
        referenceFacts: fixture.referenceFacts,
        numericalEntities: fixture.numericalEntities,
      });

      citePrecScores.push(alceResult.citePrec);
      citeRecScores.push(alceResult.citeRec);

      totalPhantomCitations += alceResult.phantomRate * alceResult.totalCitations;
      totalAllCitations += alceResult.totalCitations;

      const mechanicalChecksPass =
        alceResult.totalCitations > 0 &&
        alceResult.phantomRate === 0 &&
        qnaResult.retrieval.chunks.length > 0;

      results.push({
        id: fixture.id,
        runId: '',
        testCaseId: fixture.id,
        category: 'rag',
        inputQuery: fixture.query,
        status: mechanicalChecksPass && !retrievalStageError ? 'warn' : 'fail',
        latencyMs,
        scores: {
          vectorRetrieved: qnaResult.retrieval.debug.vector.count,
          ftsRetrieved: qnaResult.retrieval.debug.fts.count,
          retrievalTotalMs: qnaResult.retrieval.debug.totalMs,
          citePrec: alceResult.citePrec,
          citeRec: alceResult.citeRec,
          phantomRate: alceResult.totalCitations > 0 ? alceResult.phantomRate : null,
          heuristicSupport: supportedResult.passesHeuristicChecks ? 1 : 0,
          heuristicFactCoverage: supportedResult.lexicalReferenceCoverage,
          retrievedChunksCount: qnaResult.retrieval.chunks.length,
          totalCitations: alceResult.totalCitations,
          generationProviderCalls: qnaResult.generationAccounting.providerCalls,
          generationCacheHits: qnaResult.generationAccounting.cacheHits,
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
          violations: [
            ...supportedResult.violations,
            ...(qnaResult.retrieval.debug.fts.count === 0
              ? ['FTS returned zero chunks; this query relied on vector retrieval']
              : []),
            ...(retrievalStageError ? [`Retrieval stage error: ${retrievalStageError}`] : []),
            ...(mechanicalChecksPass
              ? ['Human or independently validated semantic review required before a quality claim']
              : ['Citation or retrieval mechanical check failed']),
          ],
          missingNumericalEntities: supportedResult.missingEntities,
        },
        errorDetails: retrievalStageError || null,
        createdAt: new Date(),
      });
    } catch (err: unknown) {
      const errorMsg = diagnoseEvaluationError(err);
      results.push({
        id: fixture.id,
        runId: '',
        testCaseId: fixture.id,
        category: 'rag',
        inputQuery: fixture.query,
        status: 'fail',
        latencyMs: Math.round(performance.now() - t0),
        scores: {},
        errorDetails: errorMsg,
        createdAt: new Date(),
      });
    }
  }

  const totalDurationMs = Math.round(performance.now() - startTime);

  const citePrecSummary = computeStatisticalSummary(citePrecScores);
  const citeRecSummary = computeStatisticalSummary(citeRecScores);

  const aggregatePhantomRate =
    totalAllCitations > 0
      ? Math.round((totalPhantomCitations / totalAllCitations) * 1000) / 1000
      : null;

  const passedTests = results.filter((r) => r.status === 'pass').length;
  const failedTests = results.filter((r) => r.status !== 'pass').length;

  return {
    summary: {
      citePrec: citePrecSummary,
      citeRec: citeRecSummary,
      ...(aggregatePhantomRate != null ? { phantomRate: aggregatePhantomRate } : {}),
      totalTests: results.length,
      passedTests,
      failedTests,
      retrievalObservedCases,
      ftsZeroCases,
      vectorZeroCases,
      ...(llm.name !== 'deterministic-mock-llm'
        ? {
            generationProviderCalls,
            generationCacheHits,
            generationUsageCoveredCalls,
          }
        : {}),
      ...(generationProviderCalls > 0 &&
      generationUsageCoveredCalls === generationProviderCalls &&
      results.every((r) => r.status !== 'fail')
        ? {
            tokenUsage: {
              tokensIn: totalTokensIn,
              tokensOut: totalTokensOut,
              totalTokens: totalTokensIn + totalTokensOut,
            },
          }
        : {}),
    },
    results,
    totalDurationMs,
  };
}

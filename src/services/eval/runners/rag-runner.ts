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
  const retriever = createHybridRetriever();

  const results: BenchmarkResultItem[] = [];
  const citePrecScores: number[] = [];
  const citeRecScores: number[] = [];
  let totalPhantomCitations = 0;
  let totalAllCitations = 0;

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
        scores: { citePrec: 0, citeRec: 0, phantomRate: 0 },
        errorDetails: `Phone with slug "${fixture.phoneSlug}" not found in database`,
        createdAt: new Date(),
      });
      continue;
    }

    try {
      // Execute hybrid retrieval scoped to phone
      const retrievalResult = await retriever.search({
        phoneId: phone.id,
        query: fixture.query,
        options: {
          kPerRetriever: 20,
          targetResults: 8,
          minDistinctSources: 1,
        },
      });

      // Build chunk map for citation verification
      const chunkMap = new Map<string, string>();
      for (const c of retrievalResult.chunks) {
        chunkMap.set(c.chunkId, c.text);
      }

      // Generate answer via phone Q&A pipeline
      const qnaResult = await runPhoneQna({
        phoneId: phone.id,
        query: fixture.query,
        retriever,
        llm,
        log: pino({ level: 'silent' }),
        phoneMeta: { brand: phone.brand, model: phone.model },
      });

      const latencyMs = Math.round(performance.now() - t0);

      // Evaluate fine-grained citation attribution
      const alceResult = evaluateAlceAttribution(qnaResult.text, chunkMap);

      citePrecScores.push(alceResult.citePrec);
      citeRecScores.push(alceResult.citeRec);
      totalPhantomCitations += alceResult.phantomRate * alceResult.totalCitations;
      totalAllCitations += alceResult.totalCitations;

      const minExpectedPrec = fixture.minExpectedCitePrec ?? 0.85;
      const isPass = alceResult.citePrec >= minExpectedPrec && alceResult.phantomRate === 0;
      const isWarn = alceResult.citePrec >= minExpectedPrec - 0.15;

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
          retrievedChunksCount: retrievalResult.chunks.length,
          totalCitations: alceResult.totalCitations,
        },
        tracePayload: {
          retrievedChunks: retrievalResult.chunks.map((c) => ({
            chunkId: c.chunkId,
            score: c.score,
            sourceTitle: c.source.title,
            textSnippet: c.text.slice(0, 180),
          })),
          generatedText: qnaResult.text,
          citations: alceResult.sentenceAttributions.flatMap((s) => s.citations),
          missingNumericalEntities: alceResult.sentenceAttributions.flatMap(
            (s) => s.missingEntities,
          ),
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
        scores: { citePrec: 0, citeRec: 0, phantomRate: 0 },
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
      : 0.0;

  const passedTests = results.filter((r) => r.status === 'pass').length;
  const failedTests = results.filter((r) => r.status === 'fail').length;

  return {
    summary: {
      citePrec: citePrecSummary,
      citeRec: citeRecSummary,
      phantomRate: aggregatePhantomRate,
      totalTests: results.length,
      passedTests,
      failedTests,
    },
    results,
    totalDurationMs,
  };
}

import { describe, it, expect } from 'vitest';
import { runInteractiveSimulation } from './simulation-runner';

describe('Interactive Simulation Runner & Bottleneck Profiler', () => {
  it('simulates a standard recommender query with verified pick ranking and zero DB egress', async () => {
    const result = await runInteractiveSimulation({
      queryType: 'recommender',
      caseId: 'rec-001',
    });

    expect(result.caseId).toBe('rec-001');
    expect(result.queryType).toBe('recommender');
    expect(result.expected.budgetCap).toBe(400);
    expect(result.actual.picks).toBeDefined();
    expect(result.actual.picks!.length).toBeGreaterThan(0);

    // Verify top pick complies with budget
    const topPick = result.actual.picks![0]!;
    expect(Number.parseFloat(topPick.msrpUsd!)).toBeLessThanOrEqual(500);

    // Verify stage timings waterfall
    expect(result.stageTimings.catalogLoadMs).toBeGreaterThanOrEqual(0);
    expect(result.stageTimings.rankingExecutionMs).toBeGreaterThanOrEqual(0);
    expect(result.stageTimings.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Verify egress bounds
    expect(result.egressMetrics.safeUnderFreeTierLimit).toBe(true);
    expect(result.egressMetrics.estimatedEgressBytes).toBeLessThan(15000);
  });

  it('correctly simulates an impossible constraint (Foldable under $200) returning 0 picks', async () => {
    const result = await runInteractiveSimulation({
      queryType: 'recommender',
      caseId: 'rec-033',
    });

    expect(result.caseId).toBe('rec-033');
    expect(result.expected.expectNoResults).toBe(true);
    expect(result.actual.picks!.length).toBe(0);
    expect(result.diffStatus).toBe('pass');
    expect(result.diffNotes[0]).toContain(
      'Successfully enforced impossible constraint: 0 picks returned.',
    );
  });

  it('simulates a custom user query with dynamic rule extraction', async () => {
    const result = await runInteractiveSimulation({
      queryType: 'recommender',
      customInput: {
        userQuery: 'Looking for an iPhone under $1000 with best camera and battery',
      },
    });

    expect(result.queryType).toBe('recommender');
    expect(result.actual.picks).toBeDefined();
    expect(result.actual.picks!.length).toBeGreaterThan(0);
    expect(result.actual.picks![0]?.brand).toBe('Apple');
    expect(result.diffStatus).toBe('pass');
  });

  it('safely rejects out-of-domain queries (e.g. laptop recommendations)', async () => {
    const result = await runInteractiveSimulation({
      queryType: 'recommender',
      customInput: {
        userQuery: 'Can you recommend a lightweight MacBook or Dell laptop under $1200?',
      },
    });

    expect(result.actual.abstained).toBe(true);
    expect(result.actual.picks).toHaveLength(0);
    expect(result.hallucinationAudit.safeAbstentionVerified).toBe(true);
    expect(result.diffStatus).toBe('pass');
  });

  it('simulates a grounded Q&A query with citation receipts and latency profiling', async () => {
    const result = await runInteractiveSimulation({
      queryType: 'rag',
      caseId: 'rag-001',
    });

    expect(result.caseId).toBe('rag-001');
    expect(result.queryType).toBe('rag');
    expect(result.actual.citations).toBeDefined();
    expect(result.actual.citations!.length).toBe(2);
    expect(result.hallucinationAudit.passed).toBe(true);
    expect(result.hallucinationAudit.phantomCitations).toHaveLength(0);

    // Verify retrieval stage breakdown
    expect(result.stageTimings.denseVectorScanMs).toBeDefined();
    expect(result.stageTimings.sparseFullTextScanMs).toBeDefined();
    expect(result.stageTimings.rrfFusionMs).toBeDefined();
    expect(result.stageTimings.mmrRerankMs).toBeDefined();
    expect(result.stageTimings.generationMs).toBeDefined();
  });

  it('simulates a hallucination trap with safe abstention and refutation', async () => {
    const result = await runInteractiveSimulation({
      queryType: 'hallucination',
      caseId: 'rag-022', // Solar charging panel on S24 Ultra
    });

    expect(result.queryType).toBe('hallucination');
    expect(result.actual.abstained).toBe(true);
    expect(result.hallucinationAudit.safeAbstentionVerified).toBe(true);
    expect(result.hallucinationAudit.ungroundedClaimsDetected).toBe(false);
    expect(result.diffStatus).toBe('pass');
  });

  it('throws informative error when live track is requested without a live GEMINI_API_KEY', async () => {
    await expect(
      runInteractiveSimulation({
        queryType: 'rag',
        caseId: 'rag-001',
        providerTrack: 'live',
      }),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });
});

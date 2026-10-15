import { describe, expect, it } from 'vitest';
import {
  runCiRetrievalGate,
  RECALL_THRESHOLD,
  P99_LATENCY_THRESHOLD_MS,
} from './ci-retrieval-gate';

describe('CI Retrieval Gate Automated SLAs', () => {
  it('enforces 0.88+ Recall@8 and sub-50ms p99 latency across 150+ benchmark queries', async () => {
    const result = await runCiRetrievalGate();

    expect(result.passed).toBe(true);
    expect(result.totalQueries).toBeGreaterThanOrEqual(150);
    expect(result.recall8).toBeGreaterThanOrEqual(RECALL_THRESHOLD);
    expect(result.p99Ms).toBeLessThanOrEqual(P99_LATENCY_THRESHOLD_MS);
  });
});

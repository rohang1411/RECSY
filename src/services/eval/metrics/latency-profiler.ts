/**
 * High-Resolution Latency Profiler & Concurrency Analysis.
 *
 * Implements:
 *   - Percentile ladder calculation (p50, p90, p95, p99, min, max)
 *   - Little's Law throughput analysis (L = QPS * W)
 *   - Jitter / variance telemetry
 */
import type { LatencyPercentiles } from '../types';

export function computePercentile(sortedValues: readonly number[], percentile: number): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n === 1) return sortedValues[0] ?? 0;

  const index = (percentile / 100) * (n - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  const vLower = sortedValues[lower] ?? 0;
  const vUpper = sortedValues[upper] ?? 0;

  return Math.round((vLower + weight * (vUpper - vLower)) * 100) / 100;
}

export function computeLatencyPercentiles(latenciesMs: readonly number[]): LatencyPercentiles {
  const n = latenciesMs.length;
  if (n === 0) {
    return { min: 0, p50: 0, p90: 0, p95: 0, p99: 0, max: 0, jitter: 0 };
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;
  const p50 = computePercentile(sorted, 50);
  const p90 = computePercentile(sorted, 90);
  const p95 = computePercentile(sorted, 95);
  const p99 = computePercentile(sorted, 99);

  // Mean absolute difference between consecutive latencies (jitter)
  let jitterSum = 0;
  for (let i = 1; i < n; i++) {
    jitterSum += Math.abs((latenciesMs[i] ?? 0) - (latenciesMs[i - 1] ?? 0));
  }
  const jitter = n > 1 ? Math.round((jitterSum / (n - 1)) * 100) / 100 : 0;

  return {
    min: Math.round(min * 100) / 100,
    p50,
    p90,
    p95,
    p99,
    max: Math.round(max * 100) / 100,
    jitter,
  };
}

export function computeThroughputQps(totalCompleted: number, durationMs: number): number {
  if (durationMs <= 0) return 0;
  const seconds = durationMs / 1000;
  return Math.round((totalCompleted / seconds) * 100) / 100;
}

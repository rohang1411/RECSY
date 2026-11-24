import { describe, it, expect } from 'vitest';
import { runAblationComparison, listAvailableAblations } from './ablation-runner';

describe('Automated Ablation Comparison Runner', () => {
  it('lists all 5 core architectural ablations', () => {
    const ablations = listAvailableAblations();
    expect(ablations).toHaveLength(5);
    const types = ablations.map((a) => a.ablationType);
    expect(types).toContain('hybrid_vs_dense');
    expect(types).toContain('bayesian_shrinkage');
    expect(types).toContain('slot_locking');
    expect(types).toContain('hallucination_guard');
    expect(types).toContain('thinking_budget');
  });

  it('computes hybrid vs dense retrieval ablation with statistically significant lift', () => {
    const report = runAblationComparison('hybrid_vs_dense');
    expect(report.ablationType).toBe('hybrid_vs_dense');
    expect(report.baseline.primaryMetricValue).toBe(0.75);
    expect(report.optimized.primaryMetricValue).toBe(0.885);
    expect(report.delta.relativeGainPercent).toBe(18.0);
    expect(report.delta.statisticallySignificant).toBe(true);
    expect(report.delta.pValue).toBeLessThan(0.01);
  });

  it('computes Bayesian shrinkage ranking ablation delta', () => {
    const report = runAblationComparison('bayesian_shrinkage');
    expect(report.baseline.primaryMetricValue).toBe(0.793);
    expect(report.optimized.primaryMetricValue).toBe(0.958);
    expect(report.delta.relativeGainPercent).toBe(20.8);
    expect(report.delta.statisticallySignificant).toBe(true);
  });

  it('computes zero-thinking token budget reduction ablation', () => {
    const report = runAblationComparison('thinking_budget');
    expect(report.baseline.primaryMetricValue).toBe(32.4);
    expect(report.optimized.primaryMetricValue).toBe(0.8);
    expect(report.delta.relativeGainPercent).toBe(97.5);
    expect(report.delta.direction).toBe('reduction');
  });

  it('throws on invalid ablation type', () => {
    // @ts-expect-error testing invalid type
    expect(() => runAblationComparison('non_existent_ablation')).toThrowError();
  });
});

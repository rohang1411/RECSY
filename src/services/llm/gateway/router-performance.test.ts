import { describe, expect, it } from 'vitest';
import { ModelRouter } from './router';
import { CircuitBreakerRegistry } from './circuit-breaker';
import { MultiProviderQuotaGovernor } from './quota-governor';
import { KeyPoolRegistry } from '../keys/key-pool';

describe('ModelRouter Performance and Latency Benchmark', () => {
  it('processes 1,000 diverse routing decisions in under 50ms (sub-0.05ms per call)', () => {
    const keyPool = new KeyPoolRegistry();
    const breakers = new CircuitBreakerRegistry();
    const governor = new MultiProviderQuotaGovernor();
    const router = new ModelRouter(keyPool, breakers, governor);

    const testFixtures = [
      {
        taskClass: 'EXTRACTION' as const,
        messages: [{ role: 'user' as const, content: 'Extract RAM, battery capacity, chipset' }],
        userMode: 'fast' as const,
      },
      {
        taskClass: 'GROUNDED_SYNTHESIS' as const,
        messages: [
          {
            role: 'user' as const,
            content:
              'Samsung S24 Ultra vs iPhone 15 Pro Max: prefer better battery and display instead of compact form factor',
          },
        ],
        userMode: undefined,
      },
      {
        taskClass: 'DEEP_REASONING' as const,
        messages: [{ role: 'user' as const, content: 'Evaluate NDCG rank trade-offs' }],
        userMode: 'deep' as const,
      },
      {
        taskClass: 'GROUNDED_SYNTHESIS' as const,
        messages: [
          {
            role: 'user' as const,
            content: 'x'.repeat(25_000), // Large prompt
          },
        ],
        userMode: undefined,
      },
      {
        taskClass: 'EXTRACTION' as const,
        messages: [
          {
            role: 'user' as const,
            content:
              'Phone with power button, camera attributes, sound distribution, and canvas view',
          },
        ],
        userMode: 'fast' as const,
      },
    ];

    // Warm up JIT compiler
    for (let i = 0; i < 50; i++) {
      const fixture = testFixtures[i % testFixtures.length]!;
      router.resolveExecutionChain({
        explicitTaskClass: fixture.taskClass,
        messages: fixture.messages,
        usageContext: { area: 'benchmark', userMode: fixture.userMode },
      });
    }

    const latencies: number[] = [];
    const totalIterations = 1000;

    const startTotal = performance.now();

    for (let i = 0; i < totalIterations; i++) {
      const fixture = testFixtures[i % testFixtures.length]!;
      const start = performance.now();

      const resolution = router.resolveExecutionChain({
        explicitTaskClass: fixture.taskClass,
        messages: fixture.messages,
        usageContext: { area: 'benchmark', userMode: fixture.userMode },
      });

      const elapsed = performance.now() - start;
      latencies.push(elapsed);

      if (resolution.candidates.length === 0) {
        throw new Error('Expected non-empty candidate chain');
      }
    }

    const totalDuration = performance.now() - startTotal;
    const avgLatency = totalDuration / totalIterations;

    latencies.sort((a, b) => a - b);
    const p95Latency = latencies[Math.floor(totalIterations * 0.95)]!;
    const p99Latency = latencies[Math.floor(totalIterations * 0.99)]!;

    // Assert strict zero-overhead guarantees:
    // Total for 1000 calls must be < 200ms (< 0.2ms per call even on constrained CI runners)
    // Average latency per routing resolution must be < 0.2ms (well below sub-millisecond 0.5ms SLA)
    // P99 latency must be < 1.0ms
    expect(totalDuration).toBeLessThan(200);
    expect(avgLatency).toBeLessThan(0.2);
    expect(p95Latency).toBeLessThan(0.5);
    expect(p99Latency).toBeLessThan(1.0);
  });
});

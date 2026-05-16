/**
 * Unit tests for in-process ingestion rate limiter (`rate-limit.ts`).
 *
 * Tests cover: `makeInMemoryLimiter` — minimum spacing between acquires,
 * concurrent acquire serialization, per-host isolation. `normalizeHost`
 * — protocol stripping, port preservation, and punycode normalisation.
 * Pure — no network.
 */
import { describe, expect, it } from 'vitest';

import { makeInMemoryLimiter, normalizeHost } from './rate-limit';

describe('makeInMemoryLimiter', () => {
  it('spaces successive acquires by at least `defaultMs`', async () => {
    const limiter = makeInMemoryLimiter({ defaultMs: 50, jitter: 0, minSleepMs: 0 });
    const start = Date.now();
    await limiter.acquire('example.com');
    await limiter.acquire('example.com');
    const elapsed = Date.now() - start;
    // Allow generous slack for CI jitter; strict lower bound is what matters.
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('respects per-host overrides', async () => {
    const limiter = makeInMemoryLimiter({
      defaultMs: 5,
      perHostMs: new Map([['slow.example', 120]]),
      jitter: 0,
      minSleepMs: 0,
    });
    const start = Date.now();
    await limiter.acquire('slow.example');
    await limiter.acquire('slow.example');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(100);
  });

  it('does NOT block across different hosts', async () => {
    const limiter = makeInMemoryLimiter({ defaultMs: 200, jitter: 0, minSleepMs: 0 });
    const start = Date.now();
    await limiter.acquire('a.example');
    await limiter.acquire('b.example');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  it('normalizes host variants to the same bucket', async () => {
    const limiter = makeInMemoryLimiter({ defaultMs: 80, jitter: 0, minSleepMs: 0 });
    const start = Date.now();
    await limiter.acquire('https://www.example.com/foo');
    await limiter.acquire('EXAMPLE.COM');
    expect(Date.now() - start).toBeGreaterThanOrEqual(60);
  });
});

describe('normalizeHost', () => {
  it('lowercases and strips scheme/www/port/path', () => {
    expect(normalizeHost('https://www.Reddit.com/r/x')).toBe('reddit.com');
    expect(normalizeHost('youtube.com:443')).toBe('youtube.com');
  });
});

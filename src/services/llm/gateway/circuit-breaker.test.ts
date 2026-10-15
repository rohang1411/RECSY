import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts in CLOSED state and allows requests', () => {
    const cb = new CircuitBreaker('test-provider', { failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canAttempt()).toBe(true);
  });

  it('trips to OPEN state after consecutive failures reach threshold', () => {
    const cb = new CircuitBreaker('test-provider', { failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canAttempt()).toBe(false);
  });

  it('resets consecutive failures on success', () => {
    const cb = new CircuitBreaker('test-provider', { failureThreshold: 3, cooldownMs: 1000 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    cb.recordFailure();
    expect(cb.getState()).toBe('CLOSED');
    expect(cb.canAttempt()).toBe(true);
  });

  it('transitions to HALF_OPEN after cooldown period', async () => {
    const cb = new CircuitBreaker('test-provider', { failureThreshold: 2, cooldownMs: 50 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('OPEN');
    expect(cb.canAttempt()).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect(cb.getState()).toBe('HALF_OPEN');
    expect(cb.canAttempt()).toBe(true);

    // If probe succeeds, resets to CLOSED
    cb.recordSuccess();
    expect(cb.getState()).toBe('CLOSED');
  });
});

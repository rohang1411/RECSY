export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  readonly failureThreshold?: number; // default: 3
  readonly cooldownMs?: number; // default: 60,000ms
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private nextAttemptTimestamp = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;

  constructor(
    readonly id: string,
    options?: CircuitBreakerOptions,
  ) {
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.cooldownMs = options?.cooldownMs ?? 60_000;
  }

  canAttempt(): boolean {
    const now = Date.now();
    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (now >= this.nextAttemptTimestamp) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }

    // HALF_OPEN allows 1 probe attempt
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  recordFailure(isFatal = true): void {
    if (!isFatal) return;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.nextAttemptTimestamp = Date.now() + this.cooldownMs;
    }
  }

  getState(): CircuitState {
    // If state is OPEN but cooldown elapsed, return HALF_OPEN
    if (this.state === 'OPEN' && Date.now() >= this.nextAttemptTimestamp) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.nextAttemptTimestamp = 0;
  }
}

export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  getBreaker(id: string, options?: CircuitBreakerOptions): CircuitBreaker {
    let b = this.breakers.get(id);
    if (!b) {
      b = new CircuitBreaker(id, options);
      this.breakers.set(id, b);
    }
    return b;
  }
}

/**
 * Multi-Provider Quota Governor.
 *
 * Tracks client-side pacing (RPM, TPM) and daily request budgets (RPD)
 * across multiple keys and providers (Groq, Gemini, NVIDIA NIM, Cerebras).
 * Proactively stalls micro-bursts and avoids provider 429 lockouts.
 */

function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export interface KeyRateLimitConfig {
  readonly rpm: number;
  readonly tpm: number;
  readonly rpd: number;
}

class KeyGovernor {
  private requestTimestampsMs: number[] = [];
  private tokenEvents: { readonly t: number; readonly n: number }[] = [];
  private rpdDayKey = utcDateKey();
  private rpdCount = 0;
  private forcedDepletedUntilNextDay = false;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly config: KeyRateLimitConfig) {}

  private prune(now: number): void {
    const cutoff = now - 60_000;
    this.requestTimestampsMs = this.requestTimestampsMs.filter((t) => t >= cutoff);
    this.tokenEvents = this.tokenEvents.filter((e) => e.t >= cutoff);
  }

  private sumTokensWindow(now: number): number {
    this.prune(now);
    return this.tokenEvents.reduce((acc, e) => acc + e.n, 0);
  }

  async acquire(estimateInputTokens: number): Promise<boolean> {
    const today = utcDateKey();
    if (this.rpdDayKey !== today) {
      this.rpdDayKey = today;
      this.rpdCount = 0;
      this.forcedDepletedUntilNextDay = false;
    }

    if (this.forcedDepletedUntilNextDay) {
      return false;
    }

    if (this.config.rpd > 0 && this.rpdCount >= this.config.rpd) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      this.chain = this.chain.then(async () => {
        let now = Date.now();
        this.prune(now);

        // 1. Enforce RPM pacing
        if (this.config.rpm > 0 && this.requestTimestampsMs.length >= this.config.rpm) {
          const oldest = this.requestTimestampsMs[0]!;
          const waitMs = Math.max(25, oldest + 60_050 - now);
          if (waitMs > 10_000) {
            // If waiting for RPM would take more than 10 seconds, reject so caller tries another key
            resolve(false);
            return;
          }
          await new Promise((r) => setTimeout(r, waitMs));
          now = Date.now();
          this.prune(now);
        }

        // 2. Enforce TPM pacing
        if (
          this.config.tpm > 0 &&
          this.sumTokensWindow(now) + estimateInputTokens > this.config.tpm
        ) {
          const waitMs = 2_000;
          await new Promise((r) => setTimeout(r, waitMs));
          now = Date.now();
          this.prune(now);
        }

        this.requestTimestampsMs.push(now);
        this.tokenEvents.push({ t: now, n: estimateInputTokens });
        this.rpdCount++;
        resolve(true);
      });
    });
  }

  recordMeasured(actualTokens: number): void {
    const now = Date.now();
    this.tokenEvents.push({ t: now, n: actualTokens });
  }

  markDepletedForDay(): void {
    this.forcedDepletedUntilNextDay = true;
  }

  isDepleted(): boolean {
    const today = utcDateKey();
    if (this.rpdDayKey !== today) {
      this.rpdDayKey = today;
      this.rpdCount = 0;
      this.forcedDepletedUntilNextDay = false;
      return false;
    }
    return (
      this.forcedDepletedUntilNextDay || (this.config.rpd > 0 && this.rpdCount >= this.config.rpd)
    );
  }

  getStats() {
    return {
      rpdCount: this.rpdCount,
      rpdLimit: this.config.rpd,
      rpmCurrent: this.requestTimestampsMs.length,
      rpmLimit: this.config.rpm,
      isDepleted: this.isDepleted(),
    };
  }
}

export class MultiProviderQuotaGovernor {
  private readonly governors = new Map<string, KeyGovernor>();

  private getKeyId(providerId: string, keyIndex: number): string {
    return `${providerId}:${keyIndex}`;
  }

  registerKey(providerId: string, keyIndex: number, config: KeyRateLimitConfig): void {
    const id = this.getKeyId(providerId, keyIndex);
    if (!this.governors.has(id)) {
      this.governors.set(id, new KeyGovernor(config));
    }
  }

  async acquire(
    providerId: string,
    keyIndex: number,
    estimateInputTokens: number,
  ): Promise<boolean> {
    const id = this.getKeyId(providerId, keyIndex);
    const g = this.governors.get(id);
    if (!g) return true; // Unregistered keys run unthrottled
    return g.acquire(estimateInputTokens);
  }

  recordMeasured(providerId: string, keyIndex: number, actualTokens: number): void {
    const id = this.getKeyId(providerId, keyIndex);
    this.governors.get(id)?.recordMeasured(actualTokens);
  }

  markKeyDepleted(providerId: string, keyIndex: number): void {
    const id = this.getKeyId(providerId, keyIndex);
    this.governors.get(id)?.markDepletedForDay();
  }

  isKeyDepleted(providerId: string, keyIndex: number): boolean {
    const id = this.getKeyId(providerId, keyIndex);
    return this.governors.get(id)?.isDepleted() ?? false;
  }

  getSnapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, gov] of this.governors.entries()) {
      out[key] = gov.getStats();
    }
    return out;
  }
}

let _governorInstance: MultiProviderQuotaGovernor | null = null;
export function getQuotaGovernor(): MultiProviderQuotaGovernor {
  if (!_governorInstance) {
    _governorInstance = new MultiProviderQuotaGovernor();
  }
  return _governorInstance;
}

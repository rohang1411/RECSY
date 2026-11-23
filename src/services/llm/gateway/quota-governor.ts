/**
 * Multi-Provider Quota Governor & Resource Management (Plan 31 WP-11).
 *
 * Tracks client-side pacing (RPM, TPM) and daily request budgets (RPD)
 * across multiple keys and providers (Groq, Gemini, NVIDIA NIM, Cerebras).
 *
 * Implements Token-Bucket Quota Management with Priority Tiers:
 * - Tier 1 (Interactive): Real-time user recommendations and Q&A (guaranteed reservation down to 0%).
 * - Tier 2 (On-Demand): Admin lifecycle probes and single-device refreshes (available above 5%).
 * - Tier 3 (Batch): Autonomous crawlers and bulk scorecard syntheses (throttled below 15%).
 */
import type { LlmUsageContext } from '../types';

function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export type QuotaPriorityTier = 1 | 2 | 3 | 'interactive' | 'on_demand' | 'batch';

export function normalizePriorityTier(tier?: QuotaPriorityTier): 1 | 2 | 3 {
  if (tier === 1 || tier === 'interactive') return 1;
  if (tier === 2 || tier === 'on_demand') return 2;
  if (tier === 3 || tier === 'batch') return 3;
  return 1;
}

/**
 * When daily remaining quota falls below 15%, Tier 3 (autonomous crawler & batch scorecard)
 * requests are throttled/paused to protect live interactive shopper sessions.
 */
export const BATCH_THROTTLE_REMAINING_QUOTA_RATIO = 0.15;

/**
 * When daily remaining quota falls below 5%, Tier 2 (on-demand admin)
 * requests are throttled to preserve the final reserve for Tier 1 live users.
 */
export const ON_DEMAND_THROTTLE_REMAINING_QUOTA_RATIO = 0.05;

export function resolvePriorityTierFromContext(ctx?: LlmUsageContext): 1 | 2 | 3 {
  if (ctx?.priorityTier) {
    return normalizePriorityTier(ctx.priorityTier);
  }
  const area = (ctx?.area ?? '').toLowerCase();
  const source = (ctx?.source ?? '').toLowerCase();
  const feature = (ctx?.feature ?? '').toLowerCase();

  // Tier 1: Interactive user queries
  if (
    source.includes('/api/recommend') ||
    source.includes('/api/ask') ||
    area.includes('recommend') ||
    area.includes('chat') ||
    area.includes('phone q&a')
  ) {
    return 1;
  }

  // Tier 3: Batch background crawls & bulk scoring
  if (
    source.includes('batch') ||
    source.includes('cron') ||
    area.includes('ingest') ||
    area.includes('crawler') ||
    area.includes('bulk') ||
    feature.includes('bulk')
  ) {
    return 3;
  }

  // Tier 2: On-demand admin & spec extraction
  if (
    source.includes('admin') ||
    area.includes('catalog') ||
    feature.includes('extraction') ||
    feature.includes('spec extraction')
  ) {
    return 2;
  }

  return 1;
}

export interface KeyRateLimitConfig {
  readonly rpm: number;
  readonly tpm: number;
  readonly rpd: number;
}

export class KeyGovernor {
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

  getRemainingDailyQuotaRatio(): number {
    if (this.config.rpd <= 0) return 1.0;
    const today = utcDateKey();
    if (this.rpdDayKey !== today) return 1.0;
    if (this.forcedDepletedUntilNextDay || this.rpdCount >= this.config.rpd) return 0.0;
    return Math.max(0, (this.config.rpd - this.rpdCount) / this.config.rpd);
  }

  isBatchThrottled(): boolean {
    return this.getRemainingDailyQuotaRatio() < BATCH_THROTTLE_REMAINING_QUOTA_RATIO;
  }

  async acquire(
    estimateInputTokens: number,
    priorityTier: QuotaPriorityTier = 1,
  ): Promise<boolean> {
    const today = utcDateKey();
    if (this.rpdDayKey !== today) {
      this.rpdDayKey = today;
      this.rpdCount = 0;
      this.forcedDepletedUntilNextDay = false;
    }

    if (this.forcedDepletedUntilNextDay) {
      return false;
    }

    const tier = normalizePriorityTier(priorityTier);
    const remainingRatio = this.getRemainingDailyQuotaRatio();

    // Enforce dynamic priority throttling
    if (tier === 3 && remainingRatio < BATCH_THROTTLE_REMAINING_QUOTA_RATIO) {
      return false; // Throttled to preserve quota for live interactive shoppers
    }

    if (tier === 2 && remainingRatio < ON_DEMAND_THROTTLE_REMAINING_QUOTA_RATIO) {
      return false; // Throttled to preserve last 5% emergency reserve for Tier 1
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
      remainingRatio: this.getRemainingDailyQuotaRatio(),
      isBatchThrottled: this.isBatchThrottled(),
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
    priorityTier?: QuotaPriorityTier,
  ): Promise<boolean> {
    const id = this.getKeyId(providerId, keyIndex);
    const g = this.governors.get(id);
    if (!g) return true; // Unregistered keys run unthrottled
    return g.acquire(estimateInputTokens, priorityTier);
  }

  getRemainingDailyQuotaRatio(providerId: string, keyIndex: number): number {
    const id = this.getKeyId(providerId, keyIndex);
    return this.governors.get(id)?.getRemainingDailyQuotaRatio() ?? 1.0;
  }

  isBatchThrottled(providerId: string, keyIndex: number): boolean {
    const id = this.getKeyId(providerId, keyIndex);
    return this.governors.get(id)?.isBatchThrottled() ?? false;
  }

  getTierStatus(
    providerId: string,
    keyIndex: number,
  ): {
    tier1Available: boolean;
    tier2Available: boolean;
    tier3Available: boolean;
    remainingRatio: number;
  } {
    const id = this.getKeyId(providerId, keyIndex);
    const gov = this.governors.get(id);
    if (!gov) {
      return {
        tier1Available: true,
        tier2Available: true,
        tier3Available: true,
        remainingRatio: 1.0,
      };
    }
    const remainingRatio = gov.getRemainingDailyQuotaRatio();
    const isDepleted = gov.isDepleted();
    return {
      tier1Available: !isDepleted,
      tier2Available: !isDepleted && remainingRatio >= ON_DEMAND_THROTTLE_REMAINING_QUOTA_RATIO,
      tier3Available: !isDepleted && remainingRatio >= BATCH_THROTTLE_REMAINING_QUOTA_RATIO,
      remainingRatio,
    };
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

export function initQuotaGovernorFromKeyPool(
  governor: MultiProviderQuotaGovernor,
  keyPool: {
    getKeysForProvider: (provider: string) => readonly {
      readonly keyIndex: number;
      readonly rpmLimit: number;
      readonly rpdLimit: number;
    }[];
  },
): void {
  for (const provider of [
    'gemini',
    'groq',
    'nvidia',
    'cerebras',
    'github',
    'openrouter',
  ] as const) {
    const keys = keyPool.getKeysForProvider(provider);
    for (const k of keys) {
      governor.registerKey(provider, k.keyIndex, {
        rpm: k.rpmLimit,
        tpm: k.rpmLimit * 2000,
        rpd: k.rpdLimit,
      });
    }
  }
}

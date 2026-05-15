/**
 * Client-side pacing for Google AI Studio / Gemini API free-tier style caps.
 *
 * Google's authoritative limits are enforced server-side; this module reduces
 * accidental bursts (RPM / input TPM) and tracks a conservative per-key daily
 * request budget so multi-step jobs fail predictably or hand off to a backup key.
 *
 * Limits are per API key (Google Cloud project). Tune via env when using paid tiers.
 */

export type GeminiRateLimitProfile = 'off' | 'google_ai_studio_free';

export interface GeminiGovernorOptions {
  readonly profile: GeminiRateLimitProfile;
  /** Max generate/embed requests in a rolling 60s window per key. */
  readonly rpm: number;
  /** Max prompt/input tokens in a rolling 60s window per key. */
  readonly tpmInput: number;
  /** Max successful outbound requests per UTC calendar day per key (conservative). */
  readonly rpd: number;
}

function utcDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function msUntilUtcNextDay(d = new Date()): number {
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 2, 0),
  );
  return Math.max(50, next.getTime() - d.getTime());
}

function estimateTokensFromText(s: string): number {
  // Rough upper bound for Latin-ish text; prefer slightly high to stay under TPM.
  return Math.max(1, Math.ceil(s.length / 3));
}

export function estimateTokensFromMessages(
  messages: readonly { role: string; content: string }[],
): number {
  let n = 0;
  for (const m of messages) n += estimateTokensFromText(m.content);
  return Math.max(1, n);
}

export function estimateTokensFromTexts(texts: readonly string[]): number {
  let n = 0;
  for (const t of texts) n += estimateTokensFromText(t);
  return Math.max(1, n);
}

/** Per API key — RPM / TPM windows and RPD counter. */
class KeyGovernorState {
  private requestTimestampsMs: number[] = [];
  private inputTokenEvents: { readonly t: number; readonly n: number }[] = [];
  private rpdDayKey = utcDateKey();
  private rpdCount = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly opts: GeminiGovernorOptions) {}

  private prune(now: number): void {
    const cutoff = now - 60_000;
    this.requestTimestampsMs = this.requestTimestampsMs.filter((t) => t >= cutoff);
    this.inputTokenEvents = this.inputTokenEvents.filter((e) => e.t >= cutoff);
  }

  private sumInputTokensWindow(now: number): number {
    this.prune(now);
    return this.inputTokenEvents.reduce((a, e) => a + e.n, 0);
  }

  /**
   * Returns whether this key still has daily budget for another request.
   * When false, caller should try another API key (different project) or surface an error.
   */
  async acquireOrDeclareDailyExhausted(estimateInputTokens: number): Promise<boolean> {
    if (this.opts.profile === 'off') return true;

    const run = async (): Promise<boolean> => {
      const now0 = Date.now();
      const day = utcDateKey(new Date(now0));
      if (day !== this.rpdDayKey) {
        this.rpdDayKey = day;
        this.rpdCount = 0;
      }
      if (this.rpdCount >= this.opts.rpd) return false;

      for (;;) {
        const now = Date.now();
        this.prune(now);

        if (this.requestTimestampsMs.length >= this.opts.rpm) {
          const oldestReq = this.requestTimestampsMs[0];
          if (oldestReq === undefined) {
            await new Promise((r) => setTimeout(r, 50));
            continue;
          }
          const wait = oldestReq + 60_001 - now;
          await new Promise((r) => setTimeout(r, Math.max(50, wait)));
          continue;
        }

        const tpmUsed = this.sumInputTokensWindow(now);
        if (tpmUsed + estimateInputTokens <= this.opts.tpmInput) {
          this.requestTimestampsMs.push(now);
          this.inputTokenEvents.push({ t: now, n: estimateInputTokens });
          this.rpdCount += 1;
          return true;
        }

        const oldest = this.inputTokenEvents[0]?.t ?? now;
        const wait = oldest + 60_001 - now;
        await new Promise((r) => setTimeout(r, Math.max(50, wait)));
      }
    };

    const p = this.chain.then(run);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }

  /** Replace the last reserved TPM entry with measured usage (serialized with acquire). */
  recordMeasuredInputTokens(measuredInputTokens: number): Promise<void> {
    if (this.opts.profile === 'off') return Promise.resolve();

    const p = this.chain.then(() => {
      const now = Date.now();
      this.prune(now);
      if (this.inputTokenEvents.length === 0) return;
      const lastIdx = this.inputTokenEvents.length - 1;
      const last = this.inputTokenEvents[lastIdx];
      if (last === undefined) return;
      if (now - last.t > 60_000) return;
      const n = Math.max(1, measuredInputTokens);
      this.inputTokenEvents[lastIdx] = { t: last.t, n };
    });
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}

export class GeminiRequestGovernor {
  private readonly perKey: KeyGovernorState[];

  constructor(
    keyCount: number,
    private readonly opts: GeminiGovernorOptions,
  ) {
    this.perKey = Array.from({ length: Math.max(1, keyCount) }, () => new KeyGovernorState(opts));
  }

  async acquireForKey(keyIndex: number, estimateInputTokens: number): Promise<boolean> {
    const idx = Math.min(Math.max(0, keyIndex), this.perKey.length - 1);
    return this.perKey[idx]!.acquireOrDeclareDailyExhausted(estimateInputTokens);
  }

  recordMeasuredForKey(keyIndex: number, measuredInputTokens: number): Promise<void> {
    const idx = Math.min(Math.max(0, keyIndex), this.perKey.length - 1);
    return this.perKey[idx]!.recordMeasuredInputTokens(measuredInputTokens);
  }

  msUntilNextUtcDay(): number {
    return msUntilUtcNextDay();
  }
}

export function isLikelyGeminiQuotaExhaustedError(err: unknown): boolean {
  if (err instanceof Error && err.name === 'AI_RetryError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded|status\s*code[:\s]*429|\b429\b/i.test(
    msg,
  );
}

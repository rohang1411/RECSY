/**
 * Stage timer for request pipeline latency instrumentation.
 * Normative reference: Plan 26 WP-00.
 */

export const STAGE_NAMES = [
  'rl',
  'auth',
  'abuse',
  'captcha',
  'platform',
  'reserve',
  'phone',
  'mode',
  'embed',
  'fts',
  'vector',
  'mmrVectors',
  'llmCacheRead',
  'generate',
  'firstDelta',
  'persist',
  'settle',
  'session',
  'extract',
  'aspectDefs',
  'catalog',
  'rank',
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export interface StageTimer {
  /** Runs fn, records its duration under name, rethrows errors unchanged. */
  time<T>(name: StageName, fn: () => Promise<T>): Promise<T>;
  mark(name: StageName): void; // records ms since timer creation
  record(name: StageName, durationMs: number): void; // adds explicit duration (e.g. from sub-tracer)
  snapshot(): Readonly<Partial<Record<StageName, number>>>; // rounded ms
  serverTiming(): string; // "name;dur=12.3, ..." for the Server-Timing header
}

export function createStageTimer(now: () => number = () => performance.now()): StageTimer {
  const t0 = now();
  const stages: Partial<Record<StageName, number>> = {};

  return {
    async time<T>(name: StageName, fn: () => Promise<T>): Promise<T> {
      const start = now();
      try {
        return await fn();
      } finally {
        const elapsed = now() - start;
        stages[name] = (stages[name] ?? 0) + elapsed;
      }
    },

    mark(name: StageName): void {
      stages[name] = now() - t0;
    },

    record(name: StageName, durationMs: number): void {
      stages[name] = (stages[name] ?? 0) + durationMs;
    },

    snapshot(): Readonly<Partial<Record<StageName, number>>> {
      const result: Partial<Record<StageName, number>> = {};
      for (const [k, v] of Object.entries(stages)) {
        if (typeof v === 'number') {
          result[k as StageName] = Math.round(v);
        }
      }
      return result;
    },

    serverTiming(): string {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(stages)) {
        if (typeof v === 'number') {
          parts.push(`${k};dur=${(Math.round(v * 10) / 10).toFixed(1)}`);
        }
      }
      return parts.join(', ');
    },
  };
}

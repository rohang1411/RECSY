import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { getDb } from '@/services/db/client';

let storeErrors = 0;

export function getRateLimitStats(): { storeErrors: number } {
  return { storeErrors };
}

export function incrementRateLimitStoreErrors(): void {
  storeErrors++;
}

export function resetRateLimitStats(): void {
  storeErrors = 0;
}

export interface RateLimitCheck {
  readonly key: string; // existing key formats, unchanged
  readonly windowMs: number; // 60_000 for all current admission limits
  readonly max: number;
  readonly subject: 'ip' | 'user' | 'device';
}

export interface RateLimitOutcome {
  readonly key: string;
  readonly count: number;
  readonly limited: boolean;
}

export interface RateLimitStore {
  readonly name: 'postgres' | 'redis';
  /** Increments every key atomically in one round trip and returns counts after increment. */
  consume(checks: readonly RateLimitCheck[], nowMs: number): Promise<RateLimitOutcome[]>;
}

export class PostgresRateLimitStore implements RateLimitStore {
  readonly name = 'postgres' as const;
  private readonly db: AppQueryDb;

  constructor(customDb?: AppQueryDb) {
    this.db = customDb ?? getDb();
  }

  async consume(checks: readonly RateLimitCheck[], nowMs: number): Promise<RateLimitOutcome[]> {
    if (checks.length === 0) {
      return [];
    }

    // Guard: reject duplicate keys before sending
    const seen = new Set<string>();
    for (const check of checks) {
      if (seen.has(check.key)) {
        throw new Error(`Duplicate rate limit key: ${check.key}`);
      }
      seen.add(check.key);
    }

    // Sort checks by key using plain code-unit comparison to ensure deterministic row-lock order
    const sorted = [...checks].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const rows = sorted.map((c) => ({
      k: c.key,
      w: new Date(Math.floor(nowMs / c.windowMs) * c.windowMs).toISOString(),
    }));

    const result = await this.db.execute<{ key: string; count: number }>(sql`
      INSERT INTO rate_limits (key, window_start, count)
      SELECT t.k, t.w, 1
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::text::jsonb) AS t(k text, w timestamptz)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING key, count`);

    const countByKey = new Map<string, number>();
    for (const row of result as unknown as Array<{ key?: string; count: number | string }>) {
      if (row.key) {
        countByKey.set(row.key, Number(row.count));
      } else if (checks.length === 1 && checks[0]) {
        countByKey.set(checks[0].key, Number(row.count));
      }
    }

    // Map results back by key, not by position
    return checks.map((c) => {
      const count = countByKey.get(c.key) ?? 1;
      return {
        key: c.key,
        count,
        limited: count > c.max,
      };
    });
  }
}

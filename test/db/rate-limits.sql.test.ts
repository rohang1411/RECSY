import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestClient, isLocalDb } from './helpers';

const shouldRun = isLocalDb();

describe.skipIf(!shouldRun)('Rate Limits Hot Path SQL Integration (WP-03)', () => {
  let sql: postgres.Sql;
  const createdKeys: string[] = [];

  beforeAll(() => {
    sql = createTestClient({ max: 50 });
  });

  afterAll(async () => {
    if (createdKeys.length > 0) {
      await sql`DELETE FROM rate_limits WHERE key = ANY(${createdKeys})`;
    }
    await sql.end({ timeout: 5 });
  });

  function newKey(prefix: string): string {
    const k = `${prefix}:${randomUUID()}`;
    createdKeys.push(k);
    return k;
  }

  it('increments 3 keys in one statement atomically', async () => {
    const k1 = newKey('k1');
    const k2 = newKey('k2');
    const k3 = newKey('k3');
    const now = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();

    const rows = [
      { k: k1, w: now },
      { k: k2, w: now },
      { k: k3, w: now },
    ];

    const res1 = await sql<{ key: string; count: number }[]>`
      INSERT INTO rate_limits (key, window_start, count)
      SELECT t.k, t.w::timestamptz, 1
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(k text, w timestamptz)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING key, count;
    `;

    expect(res1).toHaveLength(3);
    for (const r of res1) {
      expect(Number(r.count)).toBe(1);
    }

    // Run a second time
    const res2 = await sql<{ key: string; count: number }[]>`
      INSERT INTO rate_limits (key, window_start, count)
      SELECT t.k, t.w::timestamptz, 1
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(k text, w timestamptz)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = rate_limits.count + 1
      RETURNING key, count;
    `;

    expect(res2).toHaveLength(3);
    for (const r of res2) {
      expect(Number(r.count)).toBe(2);
    }
  });

  it('handles 40 concurrent calls for one key giving counts 1..40 with no gaps', async () => {
    const k = newKey('concurrent');
    const now = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const rows = [{ k, w: now }];

    const promises = Array.from(
      { length: 40 },
      () =>
        sql<{ key: string; count: number }[]>`
        INSERT INTO rate_limits (key, window_start, count)
        SELECT t.k, t.w::timestamptz, 1
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS t(k text, w timestamptz)
        ON CONFLICT (key, window_start)
        DO UPDATE SET count = rate_limits.count + 1
        RETURNING key, count;
      `,
    );

    const results = await Promise.all(promises);
    const counts = results.map((r) => Number(r[0]!.count)).sort((a, b) => a - b);

    expect(counts).toHaveLength(40);
    const expected = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(counts).toEqual(expected);

    // Verify against SELECT
    const [dbRow] = await sql<{ count: number }[]>`
      SELECT count FROM rate_limits WHERE key = ${k} AND window_start = ${now}::timestamptz;
    `;
    expect(Number(dbRow?.count)).toBe(40);
  });

  it('separates windows across minute boundaries (hh:mm:59.999 vs hh:(mm+1):00.000)', async () => {
    const k = newKey('window_boundary');
    const t1 = 1700000059999;
    const t2 = 1700000060000;

    const w1 = new Date(Math.floor(t1 / 60_000) * 60_000).toISOString();
    const w2 = new Date(Math.floor(t2 / 60_000) * 60_000).toISOString();

    expect(w1).not.toBe(w2);

    await sql`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (${k}, ${w1}::timestamptz, 1);
    `;

    await sql`
      INSERT INTO rate_limits (key, window_start, count)
      VALUES (${k}, ${w2}::timestamptz, 1);
    `;

    const rows = await sql<{ window_start: string; count: number }[]>`
      SELECT window_start, count FROM rate_limits WHERE key = ${k} ORDER BY window_start;
    `;

    expect(rows).toHaveLength(2);
    expect(Number(rows[0]?.count)).toBe(1);
    expect(Number(rows[1]?.count)).toBe(1);
  });
});

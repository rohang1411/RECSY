import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupTestRecords, createTestClient, isLocalDb } from './helpers';
import {
  reserveQuery,
  getEntitlementSnapshot,
  consumeUserRateLimit,
  getMeteringConfig,
} from '@/services/metering';
import type { AppQueryDb } from '@/services/db/client';

const shouldRun = isLocalDb();

describe.skipIf(!shouldRun)('Metering TypeScript Services Integration', () => {
  let sql: postgres.Sql;
  let db: AppQueryDb;
  const userIds: string[] = [];
  const deviceIds: string[] = [];

  beforeAll(() => {
    sql = createTestClient({ max: 10 });
    db = drizzle(sql) as unknown as AppQueryDb;
  });

  afterAll(async () => {
    if (!shouldRun) return;
    if (userIds.length > 0 || deviceIds.length > 0) {
      await cleanupTestRecords(sql, { userIds, deviceIds });
    }
    await sql.end();
  });

  it('runs complete reserve -> commit round trip against PostgreSQL', async () => {
    const userId = randomUUID();
    const deviceId = `dev-${randomUUID().slice(0, 16)}`;
    userIds.push(userId);
    deviceIds.push(deviceId);

    const config = getMeteringConfig({
      mode: 'enforce',
      freeDailyQueries: 2,
    });

    const lease = await reserveQuery({
      db,
      identity: { userId, deviceId, ipKey: null },
      requestId: randomUUID(),
      route: 'POST /api/recommend',
      traceId: `trace-${randomUUID().slice(0, 8)}`,
      byok: false,
      shedFree: false,
      config,
    });

    expect(lease.id).toBeDefined();
    expect(lease.id).not.toBe('off');
    expect(lease.chargeSource).toBe('daily_free');
    expect(lease.quota.freeRemaining).toBe(1);

    const settleStatus = await lease.commit({
      model: 'gemini-3-flash-preview',
      tokensIn: 500,
      tokensOut: 150,
      latencyMs: 1200,
      cacheHit: false,
    });

    expect(settleStatus).toBe('committed');
    expect(lease.settled).toBe(true);

    // Verify snapshot reflects the consumed free query
    const snap = await getEntitlementSnapshot({
      db,
      identity: { userId, deviceId },
      config,
    });

    expect(snap.signedIn).toBe(true);
    expect(snap.free.used).toBe(1);
    expect(snap.free.remaining).toBe(1);
  });

  it('runs reserve -> noCharge round trip restoring quota', async () => {
    const userId = randomUUID();
    const deviceId = `dev-${randomUUID().slice(0, 16)}`;
    userIds.push(userId);
    deviceIds.push(deviceId);

    const config = getMeteringConfig({
      mode: 'enforce',
      freeDailyQueries: 2,
    });

    const lease = await reserveQuery({
      db,
      identity: { userId, deviceId, ipKey: null },
      requestId: randomUUID(),
      route: 'POST /api/recommend',
      traceId: `trace-${randomUUID().slice(0, 8)}`,
      byok: false,
      shedFree: false,
      config,
    });

    const status = await lease.noCharge('clarify');
    expect(status).toBe('no_charge');

    const snap = await getEntitlementSnapshot({
      db,
      identity: { userId, deviceId },
      config,
    });

    expect(snap.free.used).toBe(0);
    expect(snap.free.remaining).toBe(2);
  });

  it('runs consumeUserRateLimit against PostgreSQL', async () => {
    const userId = randomUUID();
    userIds.push(userId);

    await expect(consumeUserRateLimit(userId, 'recommend', db)).resolves.toBeUndefined();
  });
});

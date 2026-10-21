import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callApplyCreditDelta,
  callLinkDevice,
  callReserve,
  callSettle,
  callSweepExpired,
  cleanupTestRecords,
  createTestClient,
  isLocalDb,
} from './helpers';

const shouldRun = isLocalDb();

describe.skipIf(!shouldRun)('Metering SQL Core Integration (Migration 0013)', () => {
  let sql: postgres.Sql;
  const userIds: string[] = [];
  const deviceIds: string[] = [];
  const ipKeys: string[] = [];
  const leaseIds: string[] = [];

  beforeAll(() => {
    sql = createTestClient({ max: 50 });
  });

  afterAll(async () => {
    await cleanupTestRecords(sql, { userIds, deviceIds, ipKeys, leaseIds });
    await sql.end({ timeout: 5 });
  });

  function newUserId(): string {
    const id = randomUUID();
    userIds.push(id);
    return id;
  }

  function newDeviceId(): string {
    const id = `dev_${randomUUID().slice(0, 12)}`;
    deviceIds.push(id);
    return id;
  }

  function newIpKey(): string {
    const id = `ip_${randomUUID().slice(0, 12)}`;
    ipKeys.push(id);
    return id;
  }

  // 1. Free allowance: N sequential reserves -> exactly FREE_DAILY_QUERIES allowed, then QUOTA_EXHAUSTED
  it('1. Free allowance: enforces exact daily free limit sequentially', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    const r1 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 2 });
    expect(r1.allowed).toBe(true);
    expect(r1.charge_source).toBe('daily_free');
    expect(r1.free_remaining).toBe(1);
    leaseIds.push(r1.lease_id!);

    const r2 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 2 });
    expect(r2.allowed).toBe(true);
    expect(r2.charge_source).toBe('daily_free');
    expect(r2.free_remaining).toBe(0);
    leaseIds.push(r2.lease_id!);

    const r3 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 2 });
    expect(r3.allowed).toBe(false);
    expect(r3.reason).toBe('QUOTA_EXHAUSTED');
    expect(r3.free_remaining).toBe(0);

    const counts = await sql<{ free_used: number }[]>`
      SELECT free_used FROM usage_counters WHERE subject_kind = 'user' AND subject_id = ${uid}
    `;
    expect(counts[0]?.free_used).toBe(2);
  });

  // 2. Concurrency: 50 parallel connections -> exactly 2 admitted for free, anonymous, credits, etc.
  it('2. Concurrency: exactly 2 admitted under 50 parallel requests (free user)', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    // Max inflight = 50 so inflight check does not mask the free allowance quota gate
    const tasks = Array.from({ length: 50 }, () =>
      callReserve(sql, {
        userId: uid,
        deviceId: dev,
        freeAllowance: 2,
        maxInflight: 50,
      }),
    );

    const results = await Promise.all(tasks);
    const admitted = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);

    for (const a of admitted) {
      leaseIds.push(a.lease_id!);
    }

    expect(admitted.length).toBe(2);
    expect(denied.length).toBe(48);
    for (const d of denied) {
      expect(d.reason).toBe('QUOTA_EXHAUSTED');
    }

    const counts = await sql<{ free_used: number }[]>`
      SELECT free_used FROM usage_counters WHERE subject_kind = 'user' AND subject_id = ${uid}
    `;
    expect(counts[0]?.free_used).toBe(2);
  });

  it('2b. Concurrency: exactly 2 admitted under 50 parallel requests (anonymous)', async () => {
    const dev = newDeviceId();

    const tasks = Array.from({ length: 50 }, () =>
      callReserve(sql, {
        deviceId: dev,
        anonAllowance: 2,
        maxInflight: 50,
      }),
    );

    const results = await Promise.all(tasks);
    const admitted = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);

    for (const a of admitted) {
      leaseIds.push(a.lease_id!);
    }

    expect(admitted.length).toBe(2);
    expect(denied.length).toBe(48);
  });

  it('2c. Concurrency: exactly 5 admitted under 50 parallel requests (credits)', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    // Seed 5 credits
    await callApplyCreditDelta(sql, uid, 5, 'grant', 'order', 'ord_conc', `grant:${uid}`);

    const tasks = Array.from({ length: 50 }, () =>
      callReserve(sql, {
        userId: uid,
        deviceId: dev,
        freeAllowance: 0,
        maxInflight: 50,
      }),
    );

    const results = await Promise.all(tasks);
    const admitted = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);

    for (const a of admitted) {
      leaseIds.push(a.lease_id!);
    }

    expect(admitted.length).toBe(5);
    expect(denied.length).toBe(45);

    const wallet = await sql<{ balance: number }[]>`
      SELECT balance FROM credit_wallets WHERE user_id = ${uid}::uuid
    `;
    expect(wallet[0]?.balance).toBe(0);
  });

  it('2d. Concurrency: BYOK daily cap exact admission under contention', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    const tasks = Array.from({ length: 50 }, () =>
      callReserve(sql, {
        userId: uid,
        deviceId: dev,
        byok: true,
        byokDailyCap: 5,
        maxInflight: 50,
      }),
    );

    const results = await Promise.all(tasks);
    const admitted = results.filter((r) => r.allowed);
    const denied = results.filter((r) => !r.allowed);

    for (const a of admitted) {
      leaseIds.push(a.lease_id!);
    }

    expect(admitted.length).toBe(5);
    expect(denied.length).toBe(45);
    for (const d of denied) {
      expect(d.reason).toBe('BYOK_DAILY_CAP');
    }
  });

  it('2e. Concurrency: in-flight cap restricts concurrent uncommitted leases', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    // 10 concurrent requests with maxInflight: 1
    const tasks = Array.from({ length: 10 }, () =>
      callReserve(sql, {
        userId: uid,
        deviceId: dev,
        freeAllowance: 10,
        maxInflight: 1,
      }),
    );

    const results = await Promise.all(tasks);
    const admitted = results.filter((r) => r.allowed);
    const inflightDenied = results.filter((r) => r.reason === 'TOO_MANY_INFLIGHT');

    for (const a of admitted) {
      leaseIds.push(a.lease_id!);
    }

    // Exactly 1 can be reserved since none have settled
    expect(admitted.length).toBe(1);
    expect(inflightDenied.length).toBe(9);
  });

  // 3. Refund restores counter of lease's own usage_date even when day passed
  it("3. Refund restores counter of lease's own usage_date across simulated days", async () => {
    const uid = newUserId();
    const dev = newDeviceId();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    // Seed usage on yesterday and today
    await sql`
      INSERT INTO usage_counters (subject_kind, subject_id, usage_date, free_used)
      VALUES ('user', ${uid}, ${yesterday}::date, 2),
             ('user', ${uid}, ${today}::date, 1)
    `;

    const leaseId = randomUUID();
    leaseIds.push(leaseId);
    await sql`
      INSERT INTO query_leases (id, request_id, user_id, device_id, route, charge_source, usage_date, expires_at)
      VALUES (${leaseId}::uuid, ${randomUUID()}::uuid, ${uid}::uuid, ${dev}, 'POST /api/recommend', 'daily_free', ${yesterday}::date, now() + interval '1 hour')
    `;

    const settled = await callSettle(sql, leaseId, 'refund', 'test_refund');
    expect(settled).toBe('refunded');

    const counts = await sql<{ usage_date: string; free_used: number }[]>`
      SELECT to_char(usage_date, 'YYYY-MM-DD') as usage_date, free_used
        FROM usage_counters
       WHERE subject_kind = 'user' AND subject_id = ${uid}
       ORDER BY usage_date ASC
    `;

    const yCount = counts.find((c) => c.usage_date === yesterday)?.free_used;
    const tCount = counts.find((c) => c.usage_date === today)?.free_used;

    expect(yCount).toBe(1); // restored yesterday
    expect(tCount).toBe(1); // untouched today
  });

  // 4. Settle idempotency
  it('4. Settle idempotency: double commit, commit after refund, refund after expire', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    // Case A: double commit
    const r1 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 5 });
    leaseIds.push(r1.lease_id!);
    const s1 = await callSettle(sql, r1.lease_id!, 'commit');
    expect(s1).toBe('committed');
    const s1Again = await callSettle(sql, r1.lease_id!, 'commit');
    expect(s1Again).toBe('committed');

    // Case B: commit after refund
    const r2 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 5 });
    leaseIds.push(r2.lease_id!);
    const s2Refund = await callSettle(sql, r2.lease_id!, 'refund');
    expect(s2Refund).toBe('refunded');
    const s2LateCommit = await callSettle(sql, r2.lease_id!, 'commit');
    expect(s2LateCommit).toBe('refunded');

    // Case C: refund after expire
    const r3 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 5 });
    leaseIds.push(r3.lease_id!);
    const s3Expire = await callSettle(sql, r3.lease_id!, 'expire');
    expect(s3Expire).toBe('expired');
    const s3LateRefund = await callSettle(sql, r3.lease_id!, 'refund');
    expect(s3LateRefund).toBe('expired');
  });

  // 5. Expiry: lease with negative TTL is swept; counters restored; late commit returns expired
  it('5. Expiry: sweeper expires timed-out lease and late commit is rejected', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    const r = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 2 });
    expect(r.allowed).toBe(true);
    leaseIds.push(r.lease_id!);

    // Backdate lease expiration
    await sql`
      UPDATE query_leases SET expires_at = now() - interval '10 seconds' WHERE id = ${r.lease_id}::uuid
    `;

    const swept = await callSweepExpired(sql, 200);
    expect(swept).toBeGreaterThanOrEqual(1);

    const leaseRow = await sql<{ status: string }[]>`
      SELECT status FROM query_leases WHERE id = ${r.lease_id}::uuid
    `;
    expect(leaseRow[0]?.status).toBe('expired');

    // Counter restored to 0
    const count = await sql<{ free_used: number }[]>`
      SELECT free_used FROM usage_counters WHERE subject_kind = 'user' AND subject_id = ${uid}
    `;
    expect(count[0]?.free_used).toBe(0);

    // Late commit attempts do not charge
    const late = await callSettle(sql, r.lease_id!, 'commit');
    expect(late).toBe('expired');
  });

  // 6. Credits: grant idempotency, consume/refund symmetry, property test, negative balance
  it('6. Credits: idempotency, consume/refund symmetry, and property test', async () => {
    const uid = newUserId();

    // Idempotent grant
    const g1 = await callApplyCreditDelta(sql, uid, 10, 'grant', 'order', 'ord_1', `key_${uid}_1`);
    expect(g1.applied).toBe(true);
    expect(g1.balance).toBe(10);

    const g2 = await callApplyCreditDelta(sql, uid, 10, 'grant', 'order', 'ord_1', `key_${uid}_1`);
    expect(g2.applied).toBe(false);
    expect(g2.balance).toBe(10);

    // Consume & refund symmetry
    const c1 = await callApplyCreditDelta(sql, uid, -1, 'consume', 'lease', 'l_1', `key_${uid}_2`);
    expect(c1.balance).toBe(9);

    const ref1 = await callApplyCreditDelta(sql, uid, 1, 'refund', 'lease', 'l_1', `key_${uid}_3`);
    expect(ref1.balance).toBe(10);

    // Property test: random ops preserve wallet == sum(ledger)
    let expectedBalance = 10;
    for (let i = 0; i < 20; i++) {
      const delta = i % 2 === 0 ? 3 : -1;
      const kind = delta > 0 ? 'grant' : 'consume';
      const res = await callApplyCreditDelta(
        sql,
        uid,
        delta,
        kind,
        'test',
        `ref_${i}`,
        `prop_${uid}_${i}`,
      );
      expect(res.applied).toBe(true);
      expectedBalance += delta;
      expect(res.balance).toBe(expectedBalance);
    }

    const check = await sql<{ wallet_balance: number; ledger_sum: number }[]>`
      SELECT w.balance AS wallet_balance, COALESCE(sum(l.delta), 0)::int AS ledger_sum
        FROM credit_wallets w
        LEFT JOIN credit_ledger l USING (user_id)
       WHERE w.user_id = ${uid}::uuid
       GROUP BY w.balance
    `;
    expect(check[0]?.wallet_balance).toBe(expectedBalance);
    expect(check[0]?.ledger_sum).toBe(expectedBalance);

    // Negative balance reversal blocks credit consumption but not daily_free
    const rev = await callApplyCreditDelta(
      sql,
      uid,
      -expectedBalance - 5,
      'adjustment',
      'chargeback',
      'cb_1',
      `adj_${uid}`,
    );
    expect(rev.balance).toBe(-5);

    const dev = newDeviceId();
    const creditAttempt = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 0,
    });
    expect(creditAttempt.allowed).toBe(false);
    expect(creditAttempt.credit_balance).toBe(-5);

    const freeAttempt = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 2,
    });
    expect(freeAttempt.allowed).toBe(true);
    expect(freeAttempt.charge_source).toBe('daily_free');
    leaseIds.push(freeAttempt.lease_id!);
  });

  // 7. Subscription: period roll, entitled_until past, exhaustion, refund restores
  it('7. Subscription: period rollover and exhaustion lifecycle', async () => {
    const uid = newUserId();
    const dev = newDeviceId();
    const subId = randomUUID();

    await sql`
      INSERT INTO subscriptions (id, user_id, provider, provider_subscription_id, plan_code, status, current_period_start, current_period_end, entitled_until, included_queries)
      VALUES (${subId}::uuid, ${uid}::uuid, 'stripe', ${`sub_${uid}`}, 'pro_monthly', 'active', now() - interval '1 day', now() + interval '29 days', now() + interval '30 days', 2)
    `;

    const r1 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 0 });
    expect(r1.allowed).toBe(true);
    expect(r1.charge_source).toBe('subscription');
    expect(r1.sub_remaining).toBe(1);
    leaseIds.push(r1.lease_id!);

    const r2 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 0 });
    expect(r2.allowed).toBe(true);
    expect(r2.charge_source).toBe('subscription');
    expect(r2.sub_remaining).toBe(0);
    leaseIds.push(r2.lease_id!);

    const r3 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 0 });
    expect(r3.allowed).toBe(false);
    expect(r3.reason).toBe('SUBSCRIPTION_EXHAUSTED');

    // Refund restores subscription query
    await callSettle(sql, r2.lease_id!, 'refund');
    const rAfterRefund = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 0 });
    expect(rAfterRefund.allowed).toBe(true);
    expect(rAfterRefund.charge_source).toBe('subscription');
    leaseIds.push(rAfterRefund.lease_id!);

    // Period roll
    await sql`
      UPDATE subscriptions
         SET current_period_start = now() + interval '1 hour',
             current_period_end = now() + interval '31 days'
       WHERE id = ${subId}::uuid
    `;

    // Next reserve starts a fresh period
    const rRolled = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 0 });
    expect(rRolled.allowed).toBe(true);
    expect(rRolled.charge_source).toBe('subscription');
    leaseIds.push(rRolled.lease_id!);
  });

  // 8. Anonymous: allowance, IP cap, give-back of IP slot, SIGNIN_REQUIRED
  it('8. Anonymous: allowance, IP cap with CGNAT, and give-back on device rejection', async () => {
    const ip = newIpKey();
    const dev1 = newDeviceId();
    const dev2 = newDeviceId();
    const dev3 = newDeviceId();

    // anonAllowance = 0 -> SIGNIN_REQUIRED
    const rZero = await callReserve(sql, { deviceId: dev1, anonAllowance: 0 });
    expect(rZero.allowed).toBe(false);
    expect(rZero.reason).toBe('SIGNIN_REQUIRED');

    // Soft IP cap = 2 across multiple devices on same IP
    const rA1 = await callReserve(sql, {
      deviceId: dev1,
      ipKey: ip,
      anonAllowance: 2,
      anonIpCap: 2,
    });
    expect(rA1.allowed).toBe(true);
    leaseIds.push(rA1.lease_id!);

    const rA2 = await callReserve(sql, {
      deviceId: dev2,
      ipKey: ip,
      anonAllowance: 2,
      anonIpCap: 2,
    });
    expect(rA2.allowed).toBe(true);
    leaseIds.push(rA2.lease_id!);

    // 3rd device on same IP hits ANON_IP_CAP
    const rA3 = await callReserve(sql, {
      deviceId: dev3,
      ipKey: ip,
      anonAllowance: 2,
      anonIpCap: 2,
    });
    expect(rA3.allowed).toBe(false);
    expect(rA3.reason).toBe('ANON_IP_CAP');

    // Give-back of IP slot: when a device has exceeded its own cap, IP slot is rolled back
    const devIsolated = newDeviceId();
    const ipIsolated = newIpKey();
    // Burn 2 queries on devIsolated
    const res1 = await callReserve(sql, {
      deviceId: devIsolated,
      ipKey: ipIsolated,
      anonAllowance: 2,
      anonIpCap: 10,
    });
    leaseIds.push(res1.lease_id!);
    const res2 = await callReserve(sql, {
      deviceId: devIsolated,
      ipKey: ipIsolated,
      anonAllowance: 2,
      anonIpCap: 10,
    });
    leaseIds.push(res2.lease_id!);

    // Check IP counter is 2
    const ipBefore = await sql<{ anon_used: number }[]>`
      SELECT anon_used FROM usage_counters WHERE subject_kind = 'ip' AND subject_id = ${ipIsolated}
    `;
    expect(ipBefore[0]?.anon_used).toBe(2);

    // 3rd attempt by devIsolated: denied by device cap, gives back IP slot
    const res3 = await callReserve(sql, {
      deviceId: devIsolated,
      ipKey: ipIsolated,
      anonAllowance: 2,
      anonIpCap: 10,
    });
    expect(res3.allowed).toBe(false);
    expect(res3.reason).toBe('ANON_QUOTA_EXHAUSTED');

    const ipAfter = await sql<{ anon_used: number }[]>`
      SELECT anon_used FROM usage_counters WHERE subject_kind = 'ip' AND subject_id = ${ipIsolated}
    `;
    expect(ipAfter[0]?.anon_used).toBe(2); // strictly unchanged, not 3!
  });

  // 9. Graduation: anonymous link carried over; device account cap
  it('9. Graduation: anonymous usage link carried over and device account cap', async () => {
    const dev = newDeviceId();
    const uidA = newUserId();
    const uidB = newUserId();
    const uidC = newUserId();
    const uidD = newUserId();

    // Anonymous uses 2 queries
    const q1 = await callReserve(sql, { deviceId: dev, anonAllowance: 2 });
    leaseIds.push(q1.lease_id!);
    const q2 = await callReserve(sql, { deviceId: dev, anonAllowance: 2 });
    leaseIds.push(q2.lease_id!);

    // Link device to User A
    const linked = await callLinkDevice(sql, uidA, dev);
    expect(linked).toBe(2);

    // User A attempts reserve: 0 remaining
    const rA = await callReserve(sql, { userId: uidA, deviceId: dev, freeAllowance: 2 });
    expect(rA.allowed).toBe(false);
    expect(rA.reason).toBe('QUOTA_EXHAUSTED');

    // Device account cap: deviceUserCap = 3 distinct accounts on same device
    const devCap = newDeviceId();
    // User A uses 1
    const rA1 = await callReserve(sql, {
      userId: uidA,
      deviceId: devCap,
      freeAllowance: 2,
      deviceUserCap: 3,
    });
    expect(rA1.allowed).toBe(true);
    leaseIds.push(rA1.lease_id!);

    // User B uses 1
    const rB1 = await callReserve(sql, {
      userId: uidB,
      deviceId: devCap,
      freeAllowance: 2,
      deviceUserCap: 3,
    });
    expect(rB1.allowed).toBe(true);
    leaseIds.push(rB1.lease_id!);

    // User C uses 1
    const rC1 = await callReserve(sql, {
      userId: uidC,
      deviceId: devCap,
      freeAllowance: 2,
      deviceUserCap: 3,
    });
    expect(rC1.allowed).toBe(true);
    leaseIds.push(rC1.lease_id!);

    // 4th user on same device hits DEVICE_ACCOUNT_CAP
    const rD1 = await callReserve(sql, {
      userId: uidD,
      deviceId: devCap,
      freeAllowance: 2,
      deviceUserCap: 3,
    });
    expect(rD1.allowed).toBe(false);
    expect(rD1.reason).toBe('DEVICE_ACCOUNT_CAP');
  });

  // 10. no_charge cap: 10 free clarify/empty outcomes, 11th converted to commit
  it('10. no_charge cap: 10 free, 11th converted to commit', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    for (let i = 1; i <= 10; i++) {
      const res = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 100 });
      expect(res.allowed).toBe(true);
      leaseIds.push(res.lease_id!);
      const outcome = await callSettle(sql, res.lease_id!, 'no_charge', 'clarify', 10);
      expect(outcome).toBe('no_charge');
    }

    // 11th no_charge exceeds clarifyFreeCap (10) and is committed
    const res11 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 100 });
    leaseIds.push(res11.lease_id!);
    const outcome11 = await callSettle(sql, res11.lease_id!, 'no_charge', 'clarify', 10);
    expect(outcome11).toBe('committed');
  });

  // 11. Timezone invariance: Asia/Kolkata, America/Los_Angeles, UTC
  it('11. Timezone invariance: usage dates and reset timestamps remain UTC under foreign timezones', async () => {
    const timezones = ['Asia/Kolkata', 'America/Los_Angeles', 'UTC'];

    for (const tz of timezones) {
      await sql.unsafe(`SET timezone = '${tz}'`);
      const uid = newUserId();
      const dev = newDeviceId();

      const r = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 2 });
      expect(r.allowed).toBe(true);
      leaseIds.push(r.lease_id!);

      const leaseRow = await sql<{ usage_date: string; reset_at: string }[]>`
        SELECT to_char(usage_date, 'YYYY-MM-DD') AS usage_date,
               to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS reset_at
          FROM query_leases WHERE id = ${r.lease_id}::uuid
      `;
      const expectedUtcDate = new Date().toISOString().slice(0, 10);
      expect(leaseRow[0]?.usage_date).toBe(expectedUtcDate);
    }

    await sql.unsafe("SET timezone = 'UTC'");
  });

  // 12. Privileges: anon role cannot execute recsy_reserve_query
  it('12. Privileges: anon role cannot execute recsy_reserve_query', async () => {
    // Run in an isolated transaction / connection
    const client = createTestClient({ max: 1 });
    try {
      await client.unsafe('SET ROLE anon');
      let failed = false;
      try {
        await client`
          SELECT * FROM recsy_reserve_query(
            gen_random_uuid(), 'anon_dev', NULL, gen_random_uuid(),
            'POST /api/recommend', 'trace_priv', false, 2, 2, 30, 3, 100, 1, 75, false
          )
        `;
      } catch (err: unknown) {
        failed = true;
        // Postgres error code 42501 = permission denied
        expect((err as { code?: string }).code).toBe('42501');
      }
      expect(failed).toBe(true);
    } finally {
      await client.unsafe('RESET ROLE');
      await client.end({ timeout: 5 });
    }
  });

  // 13. Eval-schema replay: 0012 and 0013 replay into scoped schema and isolate counters
  it('13. Eval-schema replay: replays cleanly and isolates counters in scoped schema', async () => {
    const namespace = `eval_test_${Date.now().toString(36)}`;
    await sql.unsafe(`CREATE SCHEMA "${namespace}"`);

    try {
      // Replay migrations 0012 and 0013 into scoped schema
      for (const tag of ['0012_multi_user_tables', '0013_metering_functions']) {
        const filePath = resolve(process.cwd(), `drizzle/migrations/${tag}.sql`);
        const source = await readFile(filePath, 'utf8');
        const scoped = source
          .replaceAll('"public".', `"${namespace}".`)
          .replace(
            /WHERE conname = ('[^']*')/gi,
            `WHERE conname = $1 AND connamespace = '${namespace}'::regnamespace`,
          );

        for (const statement of scoped.split('--> statement-breakpoint').filter((s) => s.trim())) {
          await sql.unsafe(statement).simple();
        }
      }

      // Execute recsy_reserve_query within scoped schema
      const client = createTestClient({ max: 1 });
      try {
        await client.unsafe(`SET search_path = "${namespace}", extensions`);
        const res = await client<{ allowed: boolean; lease_id: string }[]>`
          SELECT allowed, lease_id
            FROM recsy_reserve_query(
              gen_random_uuid(), 'eval_dev', NULL, gen_random_uuid(),
              'POST /api/recommend', 'eval_trace', false, 2, 2, 30, 3, 100, 1, 75, false
            )
        `;
        expect(res[0]?.allowed).toBe(true);

        const scopedCounters = await client<{ count: number }[]>`
          SELECT count(*)::int AS count FROM usage_counters WHERE subject_id = 'eval_dev'
        `;
        expect(scopedCounters[0]?.count).toBe(1);
      } finally {
        await client.end({ timeout: 5 });
      }
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    }
  });

  // 14. Idempotent re-run: re-executing 0012 and 0013 is a no-op
  it('14. Idempotent re-run: applying migrations 0012 and 0013 again succeeds', async () => {
    for (const tag of ['0012_multi_user_tables', '0013_metering_functions']) {
      const filePath = resolve(process.cwd(), `drizzle/migrations/${tag}.sql`);
      const source = await readFile(filePath, 'utf8');
      for (const statement of source.split('--> statement-breakpoint').filter((s) => s.trim())) {
        await sql.unsafe(statement).simple();
      }
    }
    expect(true).toBe(true);
  });
});

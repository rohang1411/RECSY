import { randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callApplyCreditDelta,
  callReserve,
  callSettle,
  cleanupTestRecords,
  createTestClient,
  isLocalDb,
} from './helpers';

const shouldRun = isLocalDb();

describe.skipIf(!shouldRun)('Section 13.8 Invariant Audit Queries', () => {
  let sql: postgres.Sql;
  const userIds: string[] = [];
  const deviceIds: string[] = [];
  const leaseIds: string[] = [];

  beforeAll(() => {
    sql = createTestClient({ max: 10 });
  });

  afterAll(async () => {
    await cleanupTestRecords(sql, { userIds, deviceIds, leaseIds });
    await sql.end({ timeout: 5 });
  });

  function newUserId(): string {
    const id = randomUUID();
    userIds.push(id);
    return id;
  }

  function newDeviceId(): string {
    const id = `dev_audit_${randomUUID().slice(0, 10)}`;
    deviceIds.push(id);
    return id;
  }

  it('Check 1: wallet balance == sum of ledger deltas', async () => {
    const uid = newUserId();

    await callApplyCreditDelta(sql, uid, 20, 'purchase', 'order', 'ord_aud_1', `aud_g_${uid}`);
    await callApplyCreditDelta(sql, uid, -5, 'consume', 'lease', 'l_aud_1', `aud_c_${uid}`);
    await callApplyCreditDelta(sql, uid, 1, 'refund', 'lease', 'l_aud_1', `aud_r_${uid}`);

    // Audit query from 13.8: find users where wallet balance <> sum(ledger.delta)
    const violations = await sql<{ user_id: string; balance: number; ledger: number }[]>`
      SELECT w.user_id, w.balance, COALESCE(SUM(l.delta), 0)::int AS ledger
        FROM credit_wallets w
        LEFT JOIN credit_ledger l USING (user_id)
       WHERE w.user_id = ${uid}::uuid
       GROUP BY w.user_id, w.balance
      HAVING w.balance <> COALESCE(SUM(l.delta), 0)
    `;

    expect(violations.length).toBe(0);
  });

  it('Check 2: user free counter == open/committed daily_free leases for current window', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    // 1 committed, 1 reserved, 1 refunded (which shouldn't count in free_used)
    const r1 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 5 });
    const r2 = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 5,
      maxInflight: 2,
    });
    const r3 = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 5,
      maxInflight: 3,
    });

    leaseIds.push(r1.lease_id!, r2.lease_id!, r3.lease_id!);

    await callSettle(sql, r1.lease_id!, 'commit');
    // r2 left as 'reserved'
    await callSettle(sql, r3.lease_id!, 'refund');

    // Audit query from 13.8: verify free_used equals active leases
    const violations = await sql<{ subject_id: string; free_used: number; leases: number }[]>`
      SELECT c.subject_id, c.free_used, COUNT(q.id)::int AS leases
        FROM usage_counters c
        LEFT JOIN query_leases q ON q.user_id::text = c.subject_id
             AND q.usage_date = c.usage_date
             AND q.charge_source = 'daily_free'
             AND q.status IN ('reserved', 'committed')
       WHERE c.subject_kind = 'user'
         AND c.subject_id = ${uid}
         AND c.usage_date >= (now() AT TIME ZONE 'UTC')::date - 1
       GROUP BY c.subject_id, c.usage_date, c.free_used
      HAVING c.free_used <> COUNT(q.id)
    `;

    expect(violations.length).toBe(0);
  });

  it('Check 3: credit consumption matches reserved/committed credit leases', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    // Grant 10 credits
    await callApplyCreditDelta(sql, uid, 10, 'purchase', 'order', 'ord_c3', `grant_${uid}`);

    // Reserve 2 credit queries (freeAllowance = 0)
    const r1 = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 0,
      maxInflight: 2,
    });
    const r2 = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 0,
      maxInflight: 2,
    });
    leaseIds.push(r1.lease_id!, r2.lease_id!);

    await callSettle(sql, r1.lease_id!, 'commit');
    // r2 left reserved

    const violations = await sql<{ active_credit_leases: number; net_consumed: number }[]>`
      SELECT COUNT(DISTINCT q.id)::int AS active_credit_leases,
             COALESCE(SUM(CASE WHEN l.kind = 'consume' THEN 1 WHEN l.kind = 'refund' THEN -1 ELSE 0 END), 0)::int AS net_consumed
        FROM credit_ledger l
        FULL OUTER JOIN query_leases q ON q.user_id = l.user_id AND q.charge_source = 'credit' AND q.status IN ('reserved', 'committed')
       WHERE (l.kind IN ('consume', 'refund') OR q.id IS NOT NULL)
         AND (l.user_id = ${uid}::uuid OR q.user_id = ${uid}::uuid)
       GROUP BY COALESCE(l.user_id, q.user_id)
      HAVING COUNT(DISTINCT q.id) <> COALESCE(SUM(CASE WHEN l.kind = 'consume' THEN 1 WHEN l.kind = 'refund' THEN -1 ELSE 0 END), 0)
    `;

    expect(violations.length).toBe(0);
  });

  it('Check 4: subscription_usage.used == committed/reserved subscription leases per period', async () => {
    const uid = newUserId();
    const dev = newDeviceId();
    const subId = randomUUID();

    await sql`
      INSERT INTO subscriptions (id, user_id, provider, provider_subscription_id, plan_code, status, current_period_start, current_period_end, entitled_until, included_queries)
      VALUES (${subId}::uuid, ${uid}::uuid, 'stripe', ${`sub_aud_${uid}`}, 'pro_monthly', 'active', now() - interval '1 day', now() + interval '29 days', now() + interval '30 days', 10)
    `;

    const r1 = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 0,
      maxInflight: 2,
    });
    const r2 = await callReserve(sql, {
      userId: uid,
      deviceId: dev,
      freeAllowance: 0,
      maxInflight: 2,
    });
    leaseIds.push(r1.lease_id!, r2.lease_id!);

    await callSettle(sql, r1.lease_id!, 'commit');
    // r2 left as reserved

    const violations = await sql<{ used: number; leases: number }[]>`
      SELECT u.used, COUNT(q.id)::int AS leases
        FROM subscription_usage u
        LEFT JOIN query_leases q ON q.charge_source = 'subscription'
             AND q.period_start = u.period_start
             AND q.status IN ('reserved', 'committed')
             AND q.user_id = (SELECT user_id FROM subscriptions WHERE id = u.subscription_id)
       WHERE u.subscription_id = ${subId}::uuid
       GROUP BY u.subscription_id, u.period_start, u.used
      HAVING u.used <> COUNT(q.id)
    `;

    expect(violations.length).toBe(0);
  });

  it('Check 5: fair charging assertion - delivered turns match committed leases', async () => {
    const uid = newUserId();
    const dev = newDeviceId();

    const r1 = await callReserve(sql, { userId: uid, deviceId: dev, freeAllowance: 5 });
    leaseIds.push(r1.lease_id!);
    await callSettle(sql, r1.lease_id!, 'commit');

    // Without a turn recorded, the audit query detects ungrounded committed lease
    const ungroundedBefore = await sql<{ id: string }[]>`
      SELECT q.id
        FROM query_leases q
        LEFT JOIN recommendation_turns rt ON rt.lease_id = q.id
        LEFT JOIN chat_queries cq ON cq.lease_id = q.id
       WHERE q.id = ${r1.lease_id}::uuid
         AND q.status = 'committed'
         AND rt.id IS NULL
         AND cq.id IS NULL
    `;
    expect(ungroundedBefore.length).toBe(1);

    // Now link to a recommendation session & turn
    const clientId = randomUUID();
    const sessId = randomUUID();
    await sql`
      INSERT INTO recommendation_clients (id, user_id, session_token)
      VALUES (${clientId}::uuid, ${uid}::uuid, ${`token_${uid}`})
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO recommendation_sessions (id, client_id)
      VALUES (${sessId}::uuid, ${clientId}::uuid)
      ON CONFLICT DO NOTHING
    `;
    await sql`
      INSERT INTO recommendation_turns (id, session_id, turn_index, user_message, lease_id, intent)
      VALUES (${randomUUID()}::uuid, ${sessId}::uuid, 1, 'Recommend me a phone', ${r1.lease_id}::uuid, 'recommend')
    `;

    // Now audit query shows 0 ungrounded
    const ungroundedAfter = await sql<{ id: string }[]>`
      SELECT q.id
        FROM query_leases q
        LEFT JOIN recommendation_turns rt ON rt.lease_id = q.id
        LEFT JOIN chat_queries cq ON cq.lease_id = q.id
       WHERE q.id = ${r1.lease_id}::uuid
         AND q.status = 'committed'
         AND rt.id IS NULL
         AND cq.id IS NULL
    `;
    expect(ungroundedAfter.length).toBe(0);

    // Clean up test turn, session & client
    await sql`DELETE FROM recommendation_turns WHERE lease_id = ${r1.lease_id}::uuid`;
    await sql`DELETE FROM recommendation_sessions WHERE id = ${sessId}::uuid`;
    await sql`DELETE FROM recommendation_clients WHERE id = ${clientId}::uuid`;
  });
});

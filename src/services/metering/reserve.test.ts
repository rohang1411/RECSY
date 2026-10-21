import { describe, expect, it, vi } from 'vitest';
import { reserveQuery } from './reserve';
import { getMeteringConfig } from './config';
import { QuotaDeniedError } from '@/lib/errors';
import type { AppQueryDb } from '@/services/db/client';

describe('reserveQuery', () => {
  const baseIdentity = {
    userId: '00000000-0000-0000-0000-000000000001',
    deviceId: 'test-device-digest',
    ipKey: 'test-ip-key',
  };

  const baseInput = {
    identity: baseIdentity,
    requestId: '00000000-0000-0000-0000-000000000002',
    route: 'POST /api/recommend' as const,
    traceId: 'trace-test-123',
    byok: false,
    shedFree: false,
  };

  it('performs zero database calls when mode is off', async () => {
    const mockDb = {
      execute: vi.fn(),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'off' });
    const lease = await reserveQuery({
      ...baseInput,
      db: mockDb,
      config,
    });

    expect(lease.id).toBe('off');
    expect(lease.isNoop).toBe(true);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('returns real lease when allowed in enforce mode', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          allowed: true,
          lease_id: '11111111-1111-1111-1111-111111111111',
          charge_source: 'daily_free',
          reason: null,
          free_remaining: 1,
          credit_balance: 0,
          sub_remaining: 0,
          reset_at: new Date('2026-10-22T00:00:00.000Z'),
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'enforce' });
    const lease = await reserveQuery({
      ...baseInput,
      db: mockDb,
      config,
    });

    expect(lease.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(lease.chargeSource).toBe('daily_free');
    expect(lease.quota.remaining).toBe(1);
    expect(lease.quota.freeRemaining).toBe(1);
    expect(lease.isNoop).toBe(false);
  });

  it('throws QuotaDeniedError on denial in enforce mode', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([
        {
          allowed: false,
          lease_id: null,
          charge_source: null,
          reason: 'QUOTA_EXHAUSTED',
          free_remaining: 0,
          credit_balance: 0,
          sub_remaining: 0,
          reset_at: new Date('2026-10-22T00:00:00.000Z'),
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'enforce' });

    try {
      await reserveQuery({
        ...baseInput,
        db: mockDb,
        config,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaDeniedError);
      const qErr = err as QuotaDeniedError;
      expect(qErr.code).toBe('QUOTA_EXHAUSTED');
      expect(qErr.status).toBe(402);
      expect(qErr.quota.reason).toBe('QUOTA_EXHAUSTED');
      expect(qErr.actions).toContain('buy_credits');
    }
  });

  it('returns no-op lease on denial in shadow mode without throwing', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValueOnce([
        {
          allowed: false,
          lease_id: null,
          charge_source: null,
          reason: 'QUOTA_EXHAUSTED',
          free_remaining: 0,
          credit_balance: 0,
          sub_remaining: 0,
          reset_at: new Date('2026-10-22T00:00:00.000Z'),
        },
      ]),
    } as unknown as AppQueryDb;

    const config = getMeteringConfig({ mode: 'shadow' });
    const lease = await reserveQuery({
      ...baseInput,
      db: mockDb,
      config,
    });

    expect(lease.id).toBe('off');
    expect(lease.isNoop).toBe(true);
  });

  it('re-reserves with maxInflightPro for active subscriber on TOO_MANY_INFLIGHT', async () => {
    const executeMock = vi
      .fn()
      // 1. Initial attempt with maxInflightFree -> TOO_MANY_INFLIGHT
      .mockResolvedValueOnce([
        {
          allowed: false,
          lease_id: null,
          charge_source: null,
          reason: 'TOO_MANY_INFLIGHT',
          free_remaining: 2,
          credit_balance: 0,
          sub_remaining: 100,
          reset_at: new Date('2026-10-22T00:00:00.000Z'),
        },
      ])
      // 2. Pro check lookup
      .mockResolvedValueOnce([{ count: 1 }])
      // 3. Second attempt with maxInflightPro -> Allowed!
      .mockResolvedValueOnce([
        {
          allowed: true,
          lease_id: '22222222-2222-2222-2222-222222222222',
          charge_source: 'subscription',
          reason: null,
          free_remaining: 2,
          credit_balance: 0,
          sub_remaining: 99,
          reset_at: new Date('2026-10-22T00:00:00.000Z'),
        },
      ]);

    const mockDb = { execute: executeMock } as unknown as AppQueryDb;
    const config = getMeteringConfig({ mode: 'enforce' });

    const lease = await reserveQuery({
      ...baseInput,
      db: mockDb,
      config,
    });

    expect(lease.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(lease.chargeSource).toBe('subscription');
    expect(executeMock).toHaveBeenCalledTimes(3);
  });

  it('retries once on Postgres deadlock 40P01', async () => {
    const deadlockErr = { code: '40P01', message: 'deadlock detected' };
    const executeMock = vi
      .fn()
      .mockRejectedValueOnce(deadlockErr)
      .mockResolvedValueOnce([
        {
          allowed: true,
          lease_id: '33333333-3333-3333-3333-333333333333',
          charge_source: 'daily_free',
          reason: null,
          free_remaining: 1,
          credit_balance: 0,
          sub_remaining: 0,
          reset_at: new Date('2026-10-22T00:00:00.000Z'),
        },
      ]);

    const mockDb = { execute: executeMock } as unknown as AppQueryDb;
    const config = getMeteringConfig({ mode: 'enforce' });

    const lease = await reserveQuery({
      ...baseInput,
      db: mockDb,
      config,
    });

    expect(lease.id).toBe('33333333-3333-3333-3333-333333333333');
    expect(executeMock).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { QueryLease } from './lease';
import type { AppQueryDb } from '@/services/db/client';

describe('QueryLease', () => {
  const baseQuota = {
    remaining: 1,
    freeRemaining: 1,
    creditBalance: 0,
    subRemaining: 0,
    resetAt: '2026-10-22T00:00:00.000Z',
  };

  it('no-op lease settles immediately without database queries', async () => {
    const mockDb = {
      execute: vi.fn(),
    } as unknown as AppQueryDb;

    const lease = new QueryLease({
      id: 'off',
      chargeSource: 'daily_free',
      quota: baseQuota,
      requestId: '00000000-0000-0000-0000-000000000001',
      route: 'POST /api/recommend',
      deviceId: 'dev-1',
      userId: 'user-1',
      traceId: 'trace-1',
      db: mockDb,
    });

    expect(lease.isNoop).toBe(true);
    expect(lease.settled).toBe(false);

    const outcome = await lease.commit();
    expect(outcome).toBe('committed');
    expect(lease.settled).toBe(true);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  it('idempotently protects against multiple settle calls', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ recsy_settle_lease: 'committed' }]),
    } as unknown as AppQueryDb;

    const lease = new QueryLease({
      id: '00000000-0000-0000-0000-000000000002',
      chargeSource: 'daily_free',
      quota: baseQuota,
      requestId: '00000000-0000-0000-0000-000000000002',
      route: 'POST /api/recommend',
      deviceId: 'dev-1',
      userId: 'user-1',
      traceId: 'trace-1',
      db: mockDb,
    });

    const out1 = await lease.commit({ model: 'gemini-2.5-flash', tokensIn: 100, tokensOut: 50 });
    const out2 = await lease.commit();
    const out3 = await lease.refund('some platform error');

    expect(out1).toBe('committed');
    expect(out2).toBe('committed');
    expect(out3).toBe('committed');
    expect(mockDb.execute).toHaveBeenCalledTimes(1);
  });

  describe('projectedQuota', () => {
    it('preserves quota values on commit outcome', () => {
      const lease = new QueryLease({
        id: 'off',
        chargeSource: 'daily_free',
        quota: baseQuota,
        requestId: 'req-1',
        route: 'POST /api/recommend',
        deviceId: 'dev-1',
        userId: 'user-1',
        traceId: 'trace-1',
      });

      const projected = lease.projectedQuota('commit');
      expect(projected.remaining).toBe(1);
      expect(projected.freeRemaining).toBe(1);
      expect(projected.outcome).toBe('committed');
    });

    it('restores free quota on no_charge and refund outcomes', () => {
      const lease = new QueryLease({
        id: 'off',
        chargeSource: 'daily_free',
        quota: baseQuota,
        requestId: 'req-1',
        route: 'POST /api/recommend',
        deviceId: 'dev-1',
        userId: 'user-1',
        traceId: 'trace-1',
      });

      const noChargeProj = lease.projectedQuota('no_charge');
      expect(noChargeProj.remaining).toBe(2);
      expect(noChargeProj.freeRemaining).toBe(2);
      expect(noChargeProj.outcome).toBe('no_charge');

      const refundProj = lease.projectedQuota('refund');
      expect(refundProj.remaining).toBe(2);
      expect(refundProj.freeRemaining).toBe(2);
      expect(refundProj.outcome).toBe('refund');
    });

    it('restores credit quota on credit charge source refund', () => {
      const lease = new QueryLease({
        id: 'off',
        chargeSource: 'credit',
        quota: { ...baseQuota, remaining: 5, creditBalance: 5, freeRemaining: 0 },
        requestId: 'req-1',
        route: 'POST /api/recommend',
        deviceId: 'dev-1',
        userId: 'user-1',
        traceId: 'trace-1',
      });

      const refundProj = lease.projectedQuota('refund');
      expect(refundProj.creditBalance).toBe(6);
      expect(refundProj.remaining).toBe(6);
    });
  });
});

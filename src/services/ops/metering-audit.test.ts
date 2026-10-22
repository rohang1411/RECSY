import { describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import {
  auditWalletLedger,
  auditFreeCounterLeases,
  auditCreditConsumption,
  auditSubscriptionUsage,
  auditFairCharging,
  runAllMeteringAudits,
} from './metering-audit';

describe('Metering Invariant Audits (WP-19)', () => {
  it('auditWalletLedger detects when wallet balance mismatches ledger sum', async () => {
    const mockDbFail = {
      execute: vi.fn().mockResolvedValue([{ user_id: 'user-drift-1', balance: 5, ledger: 4 }]),
    };
    const resFail = await auditWalletLedger(mockDbFail as unknown as AppQueryDb);
    expect(resFail.passed).toBe(false);
    expect(resFail.violationsCount).toBe(1);

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const resOk = await auditWalletLedger(mockDbOk as unknown as AppQueryDb);
    expect(resOk.passed).toBe(true);
    expect(resOk.violationsCount).toBe(0);
  });

  it('auditFreeCounterLeases detects mismatch between free_used and committed leases', async () => {
    const mockDbFail = {
      execute: vi
        .fn()
        .mockResolvedValue([
          { subject_id: 'user-1', usage_date: '2026-10-21', free_used: 2, leases: 1 },
        ]),
    };
    const resFail = await auditFreeCounterLeases(mockDbFail as unknown as AppQueryDb);
    expect(resFail.passed).toBe(false);
    expect(resFail.violationsCount).toBe(1);

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const resOk = await auditFreeCounterLeases(mockDbOk as unknown as AppQueryDb);
    expect(resOk.passed).toBe(true);
  });

  it('auditCreditConsumption detects committed credit leases missing ledger records', async () => {
    const mockDbFail = {
      execute: vi.fn().mockResolvedValue([{ lease_id: 'lease-orphan-1' }]),
    };
    const resFail = await auditCreditConsumption(mockDbFail as unknown as AppQueryDb);
    expect(resFail.passed).toBe(false);
    expect(resFail.violationsCount).toBe(1);

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const resOk = await auditCreditConsumption(mockDbOk as unknown as AppQueryDb);
    expect(resOk.passed).toBe(true);
  });

  it('auditSubscriptionUsage detects discrepancies in active subscription counters', async () => {
    const mockDbFail = {
      execute: vi
        .fn()
        .mockResolvedValue([{ subscription_id: 'sub-1', used: 10, committed_leases: 9 }]),
    };
    const resFail = await auditSubscriptionUsage(mockDbFail as unknown as AppQueryDb);
    expect(resFail.passed).toBe(false);
    expect(resFail.violationsCount).toBe(1);

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const resOk = await auditSubscriptionUsage(mockDbOk as unknown as AppQueryDb);
    expect(resOk.passed).toBe(true);
  });

  it('auditFairCharging detects committed leases with zero delivered turns or queries', async () => {
    const mockDbFail = {
      execute: vi
        .fn()
        .mockResolvedValue([{ lease_id: 'lease-undelivered', created_at: '2026-10-21T10:00:00Z' }]),
    };
    const resFail = await auditFairCharging(mockDbFail as unknown as AppQueryDb);
    expect(resFail.passed).toBe(false);
    expect(resFail.violationsCount).toBe(1);

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const resOk = await auditFairCharging(mockDbOk as unknown as AppQueryDb);
    expect(resOk.passed).toBe(true);
  });

  it('runAllMeteringAudits executes all 5 invariant checks', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const results = await runAllMeteringAudits(mockDb as unknown as AppQueryDb);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.passed)).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import {
  checkLeaseLeak,
  checkRefundRatio,
  checkLateCommit,
  checkWebhookBacklog,
  checkDisputes,
  checkNegativeCounters,
  checkLedgerDrift,
  checkPlatformCap,
  checkQuotaMode,
  checkAnonIpSpike,
  evaluateAllAlertRules,
} from './alert-rules';

describe('Operations Alert Rules (WP-19)', () => {
  it('checkLeaseLeak triggers warn on stuck leases and page on >= 20', async () => {
    const mockDbWarn = {
      execute: vi.fn().mockResolvedValue([{ count: 5 }]),
    };
    const resWarn = await checkLeaseLeak(mockDbWarn as unknown as AppQueryDb);
    expect(resWarn.fired).toBe(true);
    expect(resWarn.severity).toBe('warn');
    expect(resWarn.summary).toContain('5 reserved leases stuck');

    const mockDbPage = {
      execute: vi.fn().mockResolvedValue([{ count: 25 }]),
    };
    const resPage = await checkLeaseLeak(mockDbPage as unknown as AppQueryDb);
    expect(resPage.fired).toBe(true);
    expect(resPage.severity).toBe('page');
  });

  it('checkRefundRatio triggers page when refund ratio > 5% with >= 20 samples', async () => {
    // 3 out of 30 refunded = 10%
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ committed: 27, refunded: 3 }]),
    };
    const resFired = await checkRefundRatio(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('page');
    expect(resFired.summary).toContain('10.0%');

    // 0 out of 50 refunded = 0%
    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ committed: 50, refunded: 0 }]),
    };
    const resOk = await checkRefundRatio(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('checkLateCommit triggers warn when late commit ratio > 0.5% with >= 20 samples', async () => {
    // 2 out of 100 late = 2%
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ committed: 100, late: 2 }]),
    };
    const resFired = await checkLateCommit(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('warn');

    // 0 out of 100 late = 0%
    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ committed: 100, late: 0 }]),
    };
    const resOk = await checkLateCommit(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('checkWebhookBacklog triggers page when events older than 10m are unprocessed', async () => {
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ count: 4 }]),
    };
    const resFired = await checkWebhookBacklog(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('page');

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ count: 0 }]),
    };
    const resOk = await checkWebhookBacklog(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('checkDisputes triggers page when dispute order created in last hour', async () => {
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ count: 1 }]),
    };
    const resFired = await checkDisputes(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('page');

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ count: 0 }]),
    };
    const resOk = await checkDisputes(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('checkNegativeCounters triggers page on invalid negative rows', async () => {
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ count: 2 }]),
    };
    const resFired = await checkNegativeCounters(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('page');

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ count: 0 }]),
    };
    const resOk = await checkNegativeCounters(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('checkLedgerDrift triggers page when wallet balance differs from ledger sum', async () => {
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ count: 1 }]),
    };
    const resFired = await checkLedgerDrift(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('page');

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ count: 0 }]),
    };
    const resOk = await checkLedgerDrift(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('checkPlatformCap alerts at cap_80 (warn) and cap_100 (page)', async () => {
    const mockDbWarn = {
      execute: vi.fn().mockResolvedValue([{ cap: 1000, used: 850 }]),
    };
    const resWarn = await checkPlatformCap(mockDbWarn as unknown as AppQueryDb);
    expect(resWarn.fired).toBe(true);
    expect(resWarn.key).toBe('cap_80');
    expect(resWarn.severity).toBe('warn');

    const mockDbPage = {
      execute: vi.fn().mockResolvedValue([{ cap: 1000, used: 1050 }]),
    };
    const resPage = await checkPlatformCap(mockDbPage as unknown as AppQueryDb);
    expect(resPage.fired).toBe(true);
    expect(resPage.key).toBe('cap_100');
    expect(resPage.severity).toBe('page');
  });

  it('checkQuotaMode fires if production is not in enforce mode after launch', () => {
    const resFired = checkQuotaMode('shadow', true, true);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('page');

    const resOk = checkQuotaMode('enforce', true, true);
    expect(resOk.fired).toBe(false);

    const resPreLaunch = checkQuotaMode('shadow', true, false);
    expect(resPreLaunch.fired).toBe(false);
  });

  it('checkAnonIpSpike fires info when denials > 50 in 10 minutes', async () => {
    const mockDbFired = {
      execute: vi.fn().mockResolvedValue([{ count: 65 }]),
    };
    const resFired = await checkAnonIpSpike(mockDbFired as unknown as AppQueryDb);
    expect(resFired.fired).toBe(true);
    expect(resFired.severity).toBe('info');

    const mockDbOk = {
      execute: vi.fn().mockResolvedValue([{ count: 12 }]),
    };
    const resOk = await checkAnonIpSpike(mockDbOk as unknown as AppQueryDb);
    expect(resOk.fired).toBe(false);
  });

  it('evaluateAllAlertRules bundles and runs all active checks', async () => {
    const mockDb = {
      execute: vi.fn().mockResolvedValue([{ count: 0, cap: 5000, used: 100 }]),
    };
    const results = await evaluateAllAlertRules(mockDb as unknown as AppQueryDb, {
      quotaMode: 'enforce',
      isProduction: true,
      launchActive: true,
    });
    expect(results).toHaveLength(10);
    expect(results.every((r) => !r.fired)).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import { loadUsageDashboardData } from './usage-dashboard';
import { loadBillingDashboardData } from './billing-dashboard';

describe('Operations Dashboards Loaders (WP-19)', () => {
  it('loadUsageDashboardData loads capacity, flags, outcomes, and alerts', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          {
            key: 'kill_switch',
            value: { enabled: false },
            updated_at: '2026-10-21',
            updated_by: 'op',
          },
        ]) // flags
        .mockResolvedValueOnce([{ cap: 5000, used: 1200, kill_enabled: false }]) // cap
        .mockResolvedValueOnce([{ outcome: 'committed', count: 1200 }]) // outcome
        .mockResolvedValueOnce([{ source: 'daily_free', count: 1000 }]) // source
        .mockResolvedValueOnce([{ reason: 'QUOTA_EXHAUSTED', count: 15 }]) // denial
        .mockResolvedValueOnce([{ device_id: 'dev-1', count: 50 }]) // top devices
        .mockResolvedValueOnce([]) // abuse blocks
        .mockResolvedValue([]), // alerts queries
    };

    const data = await loadUsageDashboardData(mockDb as unknown as AppQueryDb);
    expect(data.cap.used).toBe(1200);
    expect(data.cap.cap).toBe(5000);
    expect(data.cap.rung).toBe('ok');
    expect(data.flags.kill_switch).toBeDefined();
    expect(data.leasesByOutcome).toHaveLength(1);
  });

  it('loadBillingDashboardData loads revenue, subscriptions, and recent orders', async () => {
    const mockDb = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([
          { today_cents: 10000, week_cents: 50000, month_cents: 200000, today_orders: 5 },
        ]) // rev
        .mockResolvedValueOnce([{ active_count: 10, mrr_cents: 20000 }]) // subs
        .mockResolvedValueOnce([{ failed_orders: 0, disputed_orders: 0, webhook_backlog: 0 }]) // anom
        .mockResolvedValueOnce([{ status: 'processed', count: 5 }]) // webhooks
        .mockResolvedValueOnce([
          {
            id: 'ord-1',
            user_id: 'u-1',
            provider: 'stripe',
            product_code: 'pack_10',
            amount_cents: 500,
            status: 'fulfilled',
            created_at: '2026-10-21',
          },
        ]) // orders
        .mockResolvedValue([]), // drift
    };

    const data = await loadBillingDashboardData(mockDb as unknown as AppQueryDb);
    expect(data.revenue.todayCents).toBe(10000);
    expect(data.subscriptions.activeCount).toBe(10);
    expect(data.recentOrders).toHaveLength(1);
    expect(data.ledgerDrift.fired).toBe(false);
  });
});

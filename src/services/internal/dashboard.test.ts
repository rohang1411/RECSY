import { describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import { loadUsageDashboardData } from './usage-dashboard';
import { loadBillingDashboardData } from './billing-dashboard';

describe('Operations Dashboards Loaders (WP-19)', () => {
  it('loadUsageDashboardData loads capacity, flags, outcomes, and alerts', async () => {
    let callIndex = 0;
    const mockDb = {
      execute: vi.fn((query: unknown) => {
        callIndex++;
        // The top-level Promise.all runs 9 items
        // 1: flags
        if (callIndex === 1) {
          return Promise.resolve([
            {
              key: 'kill_switch',
              value: { enabled: false },
              updated_at: '2026-10-21',
              updated_by: 'op',
            },
          ]);
        }
        // 2: cap & usage
        if (callIndex === 2) {
          return Promise.resolve([{ cap: 5000, used: 1200, kill_enabled: false }]);
        }
        // 3: leases by outcome
        if (callIndex === 3) {
          return Promise.resolve([{ outcome: 'committed', count: 1200 }]);
        }
        // 4: leases by source
        if (callIndex === 4) {
          return Promise.resolve([{ source: 'daily_free', count: 1000 }]);
        }
        // 5: denial reasons
        if (callIndex === 5) {
          return Promise.resolve([{ reason: 'QUOTA_EXHAUSTED', count: 15 }]);
        }
        // 6: top devices
        if (callIndex === 6) {
          return Promise.resolve([{ device_id: 'dev-1', count: 50 }]);
        }
        // 7: abuse blocks
        if (callIndex === 7) {
          return Promise.resolve([]);
        }
        const raw = JSON.stringify(query);
        if (raw.includes('recommendation_sessions')) {
          return Promise.resolve([
            {
              created_today: 10,
              active_users_with_history: 5,
              avg_turns: 3.2,
              legacy_count: 2,
              total_sessions: 20,
            },
          ]);
        }
        // 8 and any other queries from evaluateAllAlertRules
        return Promise.resolve([{ count: 0, committed: 0, late: 0, distinct_uids: 0 }]);
      }),
    };

    const data = await loadUsageDashboardData(mockDb as unknown as AppQueryDb);
    expect(data.cap.used).toBe(1200);
    expect(data.cap.cap).toBe(5000);
    expect(data.cap.rung).toBe('ok');
    expect(data.flags.kill_switch).toBeDefined();
    expect(data.leasesByOutcome).toHaveLength(1);
    expect(data.sessionsStats?.createdToday).toBe(10);
    expect(data.sessionsStats?.activeUsersWithHistory).toBe(5);
    expect(data.sessionsStats?.avgTurns).toBe(3.2);
    expect(data.sessionsStats?.legacyShare).toBe(10);
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

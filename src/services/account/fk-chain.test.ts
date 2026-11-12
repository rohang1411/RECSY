import { describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { AppQueryDb } from '@/services/db/client';
import {
  recommendationClients,
  recommendationSessions,
  recommendationTurns,
  recommendationFeedback,
} from '@/services/db/schema';
import { deleteUserHistory } from './history';
import { executeDeletion } from './deletion';
import { exportUserData } from './export';
import * as profileModule from '@/services/auth/profile';
import { setSupabaseAdminClientForTest } from '@/services/auth/supabase-admin';

describe('FK Chain & User History Cascade (WP-18 & Plan 25 Section 10.5 & Plan 27 WP-11)', () => {
  it('verifies Drizzle schema enforces onDelete: cascade down the recommendation graph', () => {
    // 1. recommendationSessions references recommendationClients with cascade
    const sessionConfig = getTableConfig(recommendationSessions);
    const sessionClientFk = sessionConfig.foreignKeys.find(
      (fk) => fk.reference().foreignTable === recommendationClients,
    );
    expect(sessionClientFk).toBeDefined();
    expect(sessionClientFk?.onDelete).toBe('cascade');

    // 2. recommendationTurns references recommendationSessions with cascade
    const turnConfig = getTableConfig(recommendationTurns);
    const turnSessionFk = turnConfig.foreignKeys.find(
      (fk) => fk.reference().foreignTable === recommendationSessions,
    );
    expect(turnSessionFk).toBeDefined();
    expect(turnSessionFk?.onDelete).toBe('cascade');

    // 3. recommendationFeedback references recommendationTurns with cascade
    const feedbackConfig = getTableConfig(recommendationFeedback);
    const feedbackTurnFk = feedbackConfig.foreignKeys.find(
      (fk) => fk.reference().foreignTable === recommendationTurns,
    );
    expect(feedbackTurnFk).toBeDefined();
    expect(feedbackTurnFk?.onDelete).toBe('cascade');
  });

  it('deleteUserHistory executes cascades for recommendation sessions, clients and chat queries', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
      execute: vi
        .fn()
        .mockResolvedValueOnce([{ count: 3 }]) // 3 sessions deleted
        .mockResolvedValueOnce([{ count: 2 }]) // 2 clients deleted
        .mockResolvedValueOnce([{ count: 5 }]), // 5 chat queries deleted
    };

    const result = await deleteUserHistory(
      mockDb as unknown as AppQueryDb,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(result.deleted).toBe(10);
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('executeDeletion cascades DB tables including sessions and purges user from Supabase auth.users', async () => {
    const mockDb = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
      execute: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(profileModule, 'getUserProfile').mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      billing_hold: false,
    } as unknown as Awaited<ReturnType<typeof profileModule.getUserProfile>>);

    const deleteUserMock = vi.fn().mockResolvedValue({ error: null });
    setSupabaseAdminClientForTest({
      auth: {
        admin: {
          deleteUser: deleteUserMock,
        },
      },
    } as unknown as Parameters<typeof setSupabaseAdminClientForTest>[0]);

    const res = await executeDeletion(
      mockDb as unknown as AppQueryDb,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(res.completed).toBe(true);
    expect(deleteUserMock).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111');
    expect(mockDb.execute).toHaveBeenCalledTimes(6);
    setSupabaseAdminClientForTest(null);
  });

  it('exportUserData includes Plan 27 session and turn fields', async () => {
    vi.spyOn(profileModule, 'getUserProfile').mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      email: 'user@example.com',
      display_name: 'Test',
      avatar_url: null,
      country: 'US',
      locale: 'en-US',
      terms_version: 'v1',
      terms_accepted_at: new Date('2026-01-01T00:00:00Z'),
      marketing_opt_in: false,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof profileModule.getUserProfile>>);

    const mockDb = {
      insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue({}) }),
      execute: vi
        .fn()
        // 1. Sessions
        .mockResolvedValueOnce([
          {
            id: 's-1',
            title: 'Gaming Phone',
            title_source: 'heuristic',
            status: 'active',
            is_pinned: true,
            created_at: new Date('2026-02-01T00:00:00Z'),
            updated_at: new Date('2026-02-01T00:00:00Z'),
            last_turn_at: new Date('2026-02-01T01:00:00Z'),
          },
        ])
        // 2. Turns
        .mockResolvedValueOnce([
          {
            session_id: 's-1',
            turn_index: 0,
            user_message: 'Best phone under $800',
            intent: 'recommend',
            clarifying_question: null,
            picks: [{ model: 'Pixel 9' }],
            result_meta: { v: 1, relaxed: [] },
            created_at: new Date('2026-02-01T00:00:00Z'),
          },
        ])
        // 3. chat queries
        .mockResolvedValueOnce([])
        // 4. credit ledger
        .mockResolvedValueOnce([])
        // 5. orders
        .mockResolvedValueOnce([])
        // 6. subscriptions
        .mockResolvedValueOnce([])
        // 7. usage summary
        .mockResolvedValueOnce([]),
    };

    const exported = await exportUserData(
      mockDb as unknown as AppQueryDb,
      '11111111-1111-4111-8111-111111111111',
    );

    expect(exported.sessions).toHaveLength(1);
    expect(exported.sessions[0]?.title).toBe('Gaming Phone');
    expect(exported.sessions[0]?.titleSource).toBe('heuristic');
    expect(exported.sessions[0]?.status).toBe('active');
    expect(exported.sessions[0]?.isPinned).toBe(true);
    expect(exported.sessions[0]?.turns).toHaveLength(1);
    expect(exported.sessions[0]?.turns[0]?.resultMeta).toEqual({ v: 1, relaxed: [] });
  });
});

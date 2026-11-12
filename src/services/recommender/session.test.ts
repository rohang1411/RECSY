/**
 * Unit tests for recommendation session context loading.
 *
 * The critical regression here is multi-turn clarification state: clarify
 * turns store partial requirements, and the next user message must merge with
 * those requirements instead of starting from an empty prompt.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppDb } from '@/services/db/client';

import { findSessionByCookie, getLatestRequirementsForSession } from './session';

function makeMockDb(rows: readonly { extractedRequirements: unknown }[]): AppDb {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
  return chain as unknown as AppDb;
}

describe('getLatestRequirementsForSession', () => {
  it('loads partial requirements from the latest clarify turn', async () => {
    const db = makeMockDb([
      {
        extractedRequirements: {
          budget_usd: { max: 1200 },
          priorities: [{ aspect: 'camera', weight: 1 }],
          must_haves: [],
          deal_breakers: [],
          use_cases: ['camera'],
          brand_preference: { liked: [], disliked: [] },
          confidence: 0.45,
          clarifying_question: 'Do you prefer Android or iPhone?',
        },
      },
    ]);

    const requirements = await getLatestRequirementsForSession(db, 'session-1');

    expect(requirements?.budget_usd?.max).toBe(1200);
    expect(requirements?.priorities[0]?.aspect).toBe('camera');
    expect(requirements?.clarifying_question).toBe('Do you prefer Android or iPhone?');
  });

  it('skips an unparseable latest row and returns the next parseable state', async () => {
    const db = makeMockDb([
      {
        extractedRequirements: {
          budget_usd: { max: 900 },
          priorities: [{ aspect: 'unknown-axis', weight: 1 }],
          must_haves: [],
          deal_breakers: [],
          use_cases: [],
          brand_preference: { liked: [], disliked: [] },
          confidence: 0.8,
        },
      },
      {
        extractedRequirements: {
          budget_usd: { max: 700 },
          priorities: [{ aspect: 'battery', weight: 1 }],
          must_haves: [],
          deal_breakers: [],
          use_cases: ['travel'],
          brand_preference: { liked: [], disliked: [] },
          confidence: 0.7,
        },
      },
    ]);

    const requirements = await getLatestRequirementsForSession(db, 'session-1');

    expect(requirements?.budget_usd?.max).toBe(700);
    expect(requirements?.priorities[0]?.aspect).toBe('battery');
  });
});

describe('findSessionByCookie ownership', () => {
  it('returns unowned session for anonymous caller', async () => {
    const mockSession = { id: 's1', sessionCookie: 'c1' };
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ session: mockSession, clientUserId: null, clientId: 'cl-1' }]),
    } as unknown as AppDb;

    const res = await findSessionByCookie(db, 'c1', { userId: null });
    expect(res).toBe(mockSession);
  });

  it('rejects access to registered user session by anonymous caller', async () => {
    const mockSession = { id: 's1', sessionCookie: 'c1' };
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ session: mockSession, clientUserId: 'user-999', clientId: 'cl-1' }]),
    } as unknown as AppDb;

    const res = await findSessionByCookie(db, 'c1', { userId: null });
    expect(res).toBeNull();
  });

  it('allows access to session owned by the authenticated caller', async () => {
    const mockSession = { id: 's1', sessionCookie: 'c1' };
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ session: mockSession, clientUserId: 'user-123', clientId: 'cl-1' }]),
    } as unknown as AppDb;

    const res = await findSessionByCookie(db, 'c1', { userId: 'user-123' });
    expect(res).toBe(mockSession);
  });

  it('claims unowned session when accessed by authenticated caller', async () => {
    const mockSession = { id: 's1', sessionCookie: 'c1' };
    const updateWhere = vi.fn().mockResolvedValue([]);
    const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([{ session: mockSession, clientUserId: null, clientId: 'cl-1' }]),
      update: vi.fn().mockReturnValue({ set: updateSet }),
    } as unknown as AppDb;

    const res = await findSessionByCookie(db, 'c1', { userId: 'user-123' });
    expect(res).toBe(mockSession);
    expect(db.update).toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123' }));
  });

  it('never steals another user session when accessed by different authenticated caller', async () => {
    const mockSession = { id: 's1', sessionCookie: 'c1' };
    const updateFn = vi.fn();
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi
        .fn()
        .mockResolvedValue([
          { session: mockSession, clientUserId: 'user-OTHER', clientId: 'cl-1' },
        ]),
      update: updateFn,
    } as unknown as AppDb;

    const res = await findSessionByCookie(db, 'c1', { userId: 'user-123' });
    expect(res).toBeNull();
    expect(updateFn).not.toHaveBeenCalled();
  });
});

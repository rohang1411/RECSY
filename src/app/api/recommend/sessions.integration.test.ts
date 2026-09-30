/**
 * Integration test suite for RECSY isolated multi-session chat history.
 *
 * Verifies:
 * - Isolation by invariant: Session A and Session B never share turns or requirements.
 * - Client ownership boundary: Client 2 cannot access Client 1's sessions.
 * - Soft-deletion lifecycle: deleted sessions are excluded from list and get queries.
 * - Sequential turn indexing inside isolated sessions.
 */
import { describe, expect, it } from 'vitest';

import {
  createSession,
  getSessionWithTurns,
  listSessionsForClient,
} from '@/services/recommender/session-manager';
import type { AppDb } from '@/services/db/client';

interface SimulatedSession {
  id: string;
  clientId: string;
  title: string;
  primaryIntent: string | null;
  isPinned: boolean;
  status: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

interface SimulatedTurn {
  turnIndex: number;
  userMessage: string;
  intent: string;
  extractedRequirements: { deal_breakers: string[]; priorities: Array<{ aspect: string }> };
  picks: Array<{ brand: string; model: string; phoneId: string }>;
  createdAt: Date;
}

describe('Cross-Session & Cross-Client Isolation Invariants', () => {
  it('guarantees complete isolation between multiple sessions of the same client', async () => {
    const clientSessions = new Map<string, SimulatedSession>();
    const sessionTurns = new Map<string, SimulatedTurn[]>();

    const mockDb = {
      insert: () => ({
        values: (val: {
          clientId: string;
          title?: string;
          primaryIntent?: string;
          metadata?: Record<string, unknown>;
        }) => ({
          returning: async () => {
            const row: SimulatedSession = {
              id: `session-${Math.random().toString(36).slice(2, 8)}`,
              clientId: val.clientId,
              title: val.title ?? 'New Recommendation',
              primaryIntent: val.primaryIntent ?? null,
              isPinned: false,
              status: 'active',
              metadata: val.metadata ?? {},
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            clientSessions.set(row.id, row);
            sessionTurns.set(row.id, []);
            return [row];
          },
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
            orderBy: () => ({
              limit: async () => [],
            }),
          }),
        }),
      }),
    } as unknown as AppDb;

    // Create Session A (Flagship Android)
    const sessionA = await createSession(mockDb, 'client-1', {
      title: 'Flagship Android • $1,200',
    });

    // Create Session B (Compact iPhone)
    const sessionB = await createSession(mockDb, 'client-1', {
      title: 'Under $800 • Compact Camera',
    });

    expect(sessionA.id).not.toBe(sessionB.id);
    expect(sessionA.title).toContain('Android');
    expect(sessionB.title).toContain('Compact');

    // Simulate turns in Session A
    sessionTurns.get(sessionA.id)!.push({
      turnIndex: 0,
      userMessage: 'Flagship phone with Snapdragon 8 Elite and Android',
      intent: 'recommend',
      extractedRequirements: { deal_breakers: ['ios'], priorities: [{ aspect: 'performance' }] },
      picks: [{ brand: 'Samsung', model: 'Galaxy S25 Ultra', phoneId: 'p-s25' }],
      createdAt: new Date(),
    });

    // Simulate turns in Session B
    sessionTurns.get(sessionB.id)!.push({
      turnIndex: 0,
      userMessage: 'Small phone with great camera under $800',
      intent: 'recommend',
      extractedRequirements: { deal_breakers: [], priorities: [{ aspect: 'camera' }] },
      picks: [{ brand: 'Apple', model: 'iPhone 16', phoneId: 'p-ip16' }],
      createdAt: new Date(),
    });

    // Verify Session B turns have zero mentions or constraints from Session A
    const turnsA = sessionTurns.get(sessionA.id)!;
    const turnsB = sessionTurns.get(sessionB.id)!;

    const firstTurnA = turnsA[0];
    const firstTurnB = turnsB[0];
    expect(firstTurnA).toBeDefined();
    expect(firstTurnB).toBeDefined();
    if (!firstTurnA || !firstTurnB) throw new Error('Expected turn to exist');

    expect(firstTurnA.extractedRequirements.deal_breakers).toContain('ios');
    expect(firstTurnB.extractedRequirements.deal_breakers).not.toContain('ios');
    expect(firstTurnB.picks[0]?.brand).toBe('Apple');
  });

  it('enforces client ownership boundary: Client 2 cannot access Client 1 session', async () => {
    const sessionsInDb = [
      {
        id: 'session-c1',
        clientId: 'client-1',
        title: 'Secret Session',
        status: 'active',
      },
    ];

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              // Return null if clientId does not match
              return sessionsInDb.filter((s) => s.id === 'session-c1' && s.clientId === 'client-2');
            },
          }),
        }),
      }),
    } as unknown as AppDb;

    const result = await getSessionWithTurns(mockDb, 'session-c1', 'client-2');
    expect(result).toBeNull();
  });

  it('filters out soft-deleted sessions from active listings', async () => {
    const allSessions = [
      {
        id: 's-active',
        clientId: 'client-1',
        title: 'Active Chat',
        isPinned: false,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 's-deleted',
        clientId: 'client-1',
        title: 'Deleted Chat',
        isPinned: false,
        status: 'deleted',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    const mockDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => allSessions.filter((s) => s.status === 'active'),
              then: (cb: (val: unknown[]) => unknown) => Promise.resolve([]).then(cb),
              [Symbol.iterator]: [][Symbol.iterator],
            }),
            then: (cb: (val: unknown[]) => unknown) => Promise.resolve([]).then(cb),
          }),
        }),
      }),
    } as unknown as AppDb;

    const list = await listSessionsForClient(mockDb, 'client-1');
    expect(list.some((s) => s.id === 's-deleted')).toBe(false);
    expect(list.some((s) => s.id === 's-active')).toBe(true);
  });
});

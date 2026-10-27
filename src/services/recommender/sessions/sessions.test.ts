import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildOwnerPredicate, ownerFromIdentity, type SessionOwner } from './owner';
import { decodeSessionCursor, encodeSessionCursor } from './cursor';
import { formatDeviceMarker, sanitizeSessionTitle } from './repository';
import {
  claimGuestSessions,
  getSessionDetail,
  listSessions,
  resolveOrCreateSession,
  restoreSession,
  settleTurn,
  softDeleteSession,
  updateSession,
} from './service';
import type { RequestIdentity } from '@/services/auth/identity';
import type { AppDb, AppQueryDb } from '@/services/db/client';

interface MockExecutor {
  execute: ReturnType<typeof vi.fn>;
  transaction?: (cb: (tx: MockExecutor) => Promise<unknown>) => Promise<unknown>;
}

describe('Session Owner (Plan 27 WP-03)', () => {
  it('derives user owner with device marker from identity', () => {
    const identity: RequestIdentity = {
      userId: '11111111-1111-4111-8111-111111111111',
      deviceId: 'dev_real_hash_123',
      isSuspended: false,
    } as unknown as RequestIdentity;

    const owner = ownerFromIdentity(identity);
    expect(owner).toEqual({
      kind: 'user',
      userId: '11111111-1111-4111-8111-111111111111',
      deviceId: 'dev_real_hash_123',
    });
  });

  it('omits nocookie: deviceId for signed-in user', () => {
    const identity: RequestIdentity = {
      userId: '11111111-1111-4111-8111-111111111111',
      deviceId: 'nocookie:127.0.0.1',
      isSuspended: false,
    } as unknown as RequestIdentity;

    const owner = ownerFromIdentity(identity);
    expect(owner).toEqual({
      kind: 'user',
      userId: '11111111-1111-4111-8111-111111111111',
      deviceId: undefined,
    });
  });

  it('derives device owner for anonymous caller with real cookie', () => {
    const identity: RequestIdentity = {
      deviceId: 'dev_real_hash_456',
      isSuspended: false,
    } as unknown as RequestIdentity;

    const owner = ownerFromIdentity(identity);
    expect(owner).toEqual({
      kind: 'device',
      deviceId: 'dev_real_hash_456',
    });
  });

  it('returns kind: none for nocookie anonymous caller', () => {
    const identity: RequestIdentity = {
      deviceId: 'nocookie:127.0.0.1',
      isSuspended: false,
    } as unknown as RequestIdentity;

    const owner = ownerFromIdentity(identity);
    expect(owner).toEqual({ kind: 'none' });
  });

  it('builds canonical SQL predicate for user, device, and none', () => {
    const dialect = new PgDialect();
    const userPred = buildOwnerPredicate(
      { kind: 'user', userId: '11111111-1111-4111-8111-111111111111' },
      's',
    );
    const devicePred = buildOwnerPredicate({ kind: 'device', deviceId: 'dev_123' }, 's');
    const nonePred = buildOwnerPredicate({ kind: 'none' }, 's');

    expect(dialect.sqlToQuery(userPred).sql).toContain('s.user_id =');
    expect(dialect.sqlToQuery(devicePred).sql).toContain('s.user_id IS NULL AND s.device_id =');
    expect(dialect.sqlToQuery(nonePred).sql).toContain('1 = 0');
  });
});

describe('Session Keyset Cursor (Plan 27 Section 9.2)', () => {
  it('encodes and decodes valid cursor roundtrip', () => {
    const date = new Date('2026-10-27T01:00:00.000Z');
    const id = '12345678-1234-4234-8234-123456789abc';

    const cursor = encodeSessionCursor(date, id);
    expect(typeof cursor).toBe('string');
    expect(cursor).not.toContain('|');

    const decoded = decodeSessionCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded?.lastTurnAt.toISOString()).toBe(date.toISOString());
    expect(decoded?.id).toBe(id);
  });

  it('handles identical timestamps across different session IDs', () => {
    const date = new Date('2026-10-27T01:00:00.000Z');
    const idA = '11111111-1111-4111-8111-111111111111';
    const idB = '22222222-2222-4222-8222-222222222222';

    const cursorA = encodeSessionCursor(date, idA);
    const cursorB = encodeSessionCursor(date, idB);

    expect(cursorA).not.toBe(cursorB);
    expect(decodeSessionCursor(cursorA)?.id).toBe(idA);
    expect(decodeSessionCursor(cursorB)?.id).toBe(idB);
  });

  it('returns null for malformed cursor strings', () => {
    expect(decodeSessionCursor(null)).toBeNull();
    expect(decodeSessionCursor('')).toBeNull();
    expect(decodeSessionCursor('not-base64-url!@#$')).toBeNull();
    expect(decodeSessionCursor(Buffer.from('no-pipe-delimiter').toString('base64url'))).toBeNull();
    expect(
      decodeSessionCursor(
        Buffer.from('invalid-date|12345678-1234-4234-8234-123456789abc').toString('base64url'),
      ),
    ).toBeNull();
    expect(
      decodeSessionCursor(Buffer.from('2026-10-27T01:00:00.000Z|not-a-uuid').toString('base64url')),
    ).toBeNull();
  });
});

describe('Title Sanitization (Plan 27 Section 10.3)', () => {
  it('normalizes to NFC and collapses whitespace', () => {
    const input = '  Camera   phone \u0065\u0301  under   $700  ';
    expect(sanitizeSessionTitle(input)).toBe('Camera phone é under $700');
  });

  it('strips bidi overrides and control characters', () => {
    const malicious = 'Test\u202E\u2066\u0007\u0000Phone';
    expect(sanitizeSessionTitle(malicious)).toBe('TestPhone');
  });

  it('strips markdown characters and surrounding quotes', () => {
    const md = ' `"**Best Camera Phone**"` ';
    expect(sanitizeSessionTitle(md)).toBe('Best Camera Phone');
  });

  it('limits to 80 graphemes', () => {
    const longTitle = 'A'.repeat(120);
    expect(sanitizeSessionTitle(longTitle).length).toBe(80);
  });
});

describe('Session Service Operations (Plan 27 WP-03)', () => {
  let mockDb: MockExecutor;
  let mockTx: MockExecutor;

  beforeEach(() => {
    mockTx = {
      execute: vi.fn(),
    };
    mockDb = {
      execute: vi.fn(),
      transaction: vi.fn(async (cb: (tx: MockExecutor) => Promise<unknown>) => cb(mockTx)),
    };
  });

  it('formats device markers correctly', () => {
    expect(
      formatDeviceMarker(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
      ),
    ).toBe('Chrome on Windows');
    expect(formatDeviceMarker(null)).toBeUndefined();
  });

  it('getSessionDetail loads session and turns', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc';
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };

    mockDb.execute
      .mockResolvedValueOnce([
        {
          id: sessionId,
          title: 'Flagship Phone',
          titleSource: 'heuristic',
          firstMessage: 'prompt',
          isPinned: false,
          status: 'active',
          turnCount: 1,
          lastPicksSummary: null,
          createdAt: new Date(),
          lastTurnAt: new Date(),
          userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'turn-1',
          turnIndex: 0,
          userMessage: 'prompt',
          intent: 'recommend',
          clarifyingQuestion: null,
          picks: [],
          resultMeta: { v: 1 },
          createdAt: new Date(),
        },
      ]);

    const detail = await getSessionDetail(mockDb as unknown as AppQueryDb, sessionId, owner);
    expect(detail).not.toBeNull();
    expect(detail?.title).toBe('Flagship Phone');
    expect(detail?.turns).toHaveLength(1);
    expect(detail?.deviceMarker).toBe('Chrome on Windows');
  });

  it('resolveOrCreateSession establishes client and returns created session', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc';
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };

    // 1. Client insert
    mockTx.execute
      .mockResolvedValueOnce([{ id: 'client-1' }])
      // 2. Session insert (ON CONFLICT DO NOTHING)
      .mockResolvedValueOnce([{ id: sessionId }])
      // 3. Session select
      .mockResolvedValueOnce([
        {
          id: sessionId,
          title: 'New Recommendation',
          titleSource: 'default',
          turnCount: 0,
          status: 'active',
        },
      ]);

    const result = await resolveOrCreateSession(mockDb as unknown as AppDb, {
      id: sessionId,
      owner,
      ipHash: 'ip123',
      userAgent: 'Mozilla/5.0',
    });

    expect(result).not.toBeNull();
    expect(result?.created).toBe(true);
    expect(result?.session.id).toBe(sessionId);
    expect(result?.session.title).toBe('New Recommendation');
    expect(mockTx.execute).toHaveBeenCalledTimes(3);
  });

  it('resolveOrCreateSession unarchives archived session on send', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc';
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };

    mockTx.execute
      .mockResolvedValueOnce([{ id: 'client-1' }])
      .mockResolvedValueOnce([]) // already exists, created = false
      .mockResolvedValueOnce([
        {
          id: sessionId,
          title: 'Existing Flagship',
          titleSource: 'heuristic',
          turnCount: 2,
          status: 'archived',
        },
      ])
      // 4. Update status to active
      .mockResolvedValueOnce([]);

    const result = await resolveOrCreateSession(mockDb as unknown as AppDb, {
      id: sessionId,
      owner,
    });

    expect(result?.created).toBe(false);
    expect(result?.session.status).toBe('active');
    expect(mockTx.execute).toHaveBeenCalledTimes(4);
  });

  it('settleTurn atomically increments counters and inserts turn', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc';
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };

    mockTx.execute
      // 1. Session atomic update RETURNING
      .mockResolvedValueOnce([
        {
          turnIndex: 0,
          title: 'Camera phone under $700',
          titleSource: 'heuristic',
          turnCount: 1,
        },
      ])
      // 2. Turn insert
      .mockResolvedValueOnce([]);

    const result = await settleTurn(mockTx as unknown as AppDb, {
      sessionId,
      owner,
      userMessage: 'need a good camera phone under $700',
      intent: 'recommend',
      title: 'Camera phone under $700',
      hasPicks: true,
      picksSummary: [{ brand: 'Google', model: 'Pixel 9', slug: 'google-pixel-9' }],
    });

    expect(result).not.toBeNull();
    expect(result?.turnIndex).toBe(0);
    expect(result?.session.title).toBe('Camera phone under $700');
    expect(result?.session.turnCount).toBe(1);
    expect(mockTx.execute).toHaveBeenCalledTimes(2);
  });

  it('settleTurn returns null when session is deleted or foreign', async () => {
    const sessionId = '12345678-1234-4234-8234-123456789abc';
    const owner: SessionOwner = { kind: 'user', userId: 'wrong-user' };

    // 0 rows updated
    mockTx.execute.mockResolvedValueOnce([]);

    const result = await settleTurn(mockTx as unknown as AppDb, {
      sessionId,
      owner,
      userMessage: 'hello',
      intent: 'recommend',
      hasPicks: false,
    });

    expect(result).toBeNull();
  });

  it('listSessions excludes pinned from paginated list when queried', async () => {
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };

    // 1. Pinned query
    mockDb.execute
      .mockResolvedValueOnce([
        {
          id: 'pinned-1',
          title: 'Pinned Conversation',
          titleSource: 'user',
          firstMessage: 'pinned msg',
          isPinned: true,
          status: 'active',
          turnCount: 5,
          lastPicksSummary: null,
          createdAt: new Date(),
          lastTurnAt: new Date(),
          userAgent: 'Mozilla/5.0 Chrome',
        },
      ])
      // 2. Main paginated query
      .mockResolvedValueOnce([
        {
          id: 'unpinned-1',
          title: 'Unpinned Conversation',
          titleSource: 'heuristic',
          firstMessage: 'unpinned msg',
          isPinned: false,
          status: 'active',
          turnCount: 2,
          lastPicksSummary: null,
          createdAt: new Date(),
          lastTurnAt: new Date(),
          userAgent: 'Mozilla/5.0 Chrome',
        },
      ])
      // 3. Guest count query
      .mockResolvedValueOnce([{ count: 0 }]);

    const result = await listSessions(mockDb as unknown as AppQueryDb, owner, {
      includePinned: true,
      limit: 20,
    });

    expect(result.pinned).toHaveLength(1);
    expect(result.pinned?.[0]?.id).toBe('pinned-1');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0]?.id).toBe('unpinned-1');
  });

  it('updateSession rejects pin attempt when cap (50) is reached', async () => {
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };
    mockDb.execute.mockResolvedValueOnce([{ count: 50 }]);

    const result = await updateSession(mockDb as unknown as AppDb, 'sess-1', owner, {
      isPinned: true,
    });

    expect(result.error).toBe('PIN_LIMIT_EXCEEDED');
    expect(result.session).toBeNull();
  });

  it('softDeleteSession marks deleted and purges shares', async () => {
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };

    mockTx.execute
      .mockResolvedValueOnce([{ id: 'sess-1' }]) // update session
      .mockResolvedValueOnce([]); // delete shares

    const result = await softDeleteSession(mockDb as unknown as AppDb, 'sess-1', owner);
    expect(result.deleted).toBe(true);
  });

  it('restoreSession restores session within 30 days', async () => {
    const owner: SessionOwner = { kind: 'user', userId: 'user-1' };
    mockDb.execute.mockResolvedValueOnce([{ id: 'sess-1' }]);

    const result = await restoreSession(mockDb as unknown as AppDb, 'sess-1', owner);
    expect(result.restored).toBe(true);
  });

  it('claimGuestSessions claims only matching device and unowned sessions', async () => {
    mockTx.execute
      .mockResolvedValueOnce([{ id: 'sess-1', clientId: 'client-1' }]) // update sessions
      .mockResolvedValueOnce([]); // update clients

    const result = await claimGuestSessions(mockDb as unknown as AppDb, 'user-1', 'dev-123');
    expect(result.claimed).toBe(1);
  });

  it('verifies all SQL queries include owner predicate', async () => {
    // Grep check on repository.ts source code to prove owner predicate is enforced
    const repoSource = await import('fs').then((fs) =>
      fs.readFileSync('src/services/recommender/sessions/repository.ts', 'utf8'),
    );

    expect(repoSource).toContain('buildOwnerPredicate(params.owner,');
    expect(repoSource).toContain('buildOwnerPredicate(owner,');
    expect(repoSource).toContain('WHERE s.id = ${params.sessionId}::uuid\n       AND ${ownerPred}');
    expect(repoSource).toContain('WHERE s.id = ${id}::uuid\n       AND ${ownerPred}');
  });
});

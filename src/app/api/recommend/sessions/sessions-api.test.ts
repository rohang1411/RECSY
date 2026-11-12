import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { AppError, RateLimitError } from '@/lib/errors';
import * as identityModule from '@/services/auth/identity';
import * as perfFlagsModule from '@/services/perf/flags';
import * as rateLimitModule from '@/services/rate-limit';
import * as sessionServiceModule from '@/services/recommender/sessions/service';

import { GET as listSessionsHandler, POST as createSessionHandler } from './route';
import {
  GET as getDetailHandler,
  PATCH as updateSessionHandler,
  DELETE as deleteSessionHandler,
} from './[id]/route';
import { POST as restoreSessionHandler } from './[id]/restore/route';
import { POST as claimSessionsHandler } from './claim/route';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn().mockReturnValue({}),
}));
vi.mock('@/services/auth/identity');
vi.mock('@/services/perf/flags', async (importOriginal) => {
  const actual = await importOriginal<typeof perfFlagsModule>();
  return {
    ...actual,
    getPerfFlags: vi.fn(),
  };
});
vi.mock('@/services/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof rateLimitModule>();
  return {
    ...actual,
    consumeSessionRateLimit: vi.fn(),
  };
});
vi.mock('@/services/recommender/sessions/service');

const TEST_USER_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SESSION_ID = '22222222-2222-4222-8222-222222222222';
const TEST_DEVICE_ID = 'dev-test-123';

const ON_PERF_FLAGS: perfFlagsModule.PerfFlags = {
  ...perfFlagsModule.DEFAULT_PERF_FLAGS,
  recommend_sessions: 'on',
};

const OFF_PERF_FLAGS: perfFlagsModule.PerfFlags = {
  ...perfFlagsModule.DEFAULT_PERF_FLAGS,
  recommend_sessions: 'off',
};

const INTERNAL_PERF_FLAGS: perfFlagsModule.PerfFlags = {
  ...perfFlagsModule.DEFAULT_PERF_FLAGS,
  recommend_sessions: 'internal',
  recommend_sessions_internal_user_ids: [TEST_USER_ID],
};

function createMockRequest(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): NextRequest {
  const headers = new Headers({
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
    'sec-fetch-site': 'same-origin',
    ...(options.headers ?? {}),
  });

  return new NextRequest(url, {
    method: options.method ?? 'GET',
    headers,
    body: options.body,
  });
}

describe('Recommendation Sessions REST API Suite (WP-05)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(perfFlagsModule.getPerfFlags).mockResolvedValue(ON_PERF_FLAGS);
    vi.mocked(rateLimitModule.consumeSessionRateLimit).mockResolvedValue(undefined);
    vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
      userId: TEST_USER_ID,
      deviceId: TEST_DEVICE_ID,
      isSuspended: false,
    } as identityModule.RequestIdentity);
  });

  describe('Feature Flag Gating', () => {
    it('returns 404 when recommend_sessions flag is off', async () => {
      vi.mocked(perfFlagsModule.getPerfFlags).mockResolvedValue(OFF_PERF_FLAGS);

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions');
      const res = await listSessionsHandler(req);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 404 when flag is internal and user is not in internal list', async () => {
      vi.mocked(perfFlagsModule.getPerfFlags).mockResolvedValue(INTERNAL_PERF_FLAGS);
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: '33333333-3333-4333-8333-333333333333',
        deviceId: TEST_DEVICE_ID,
        isSuspended: false,
      } as identityModule.RequestIdentity);

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions');
      const res = await listSessionsHandler(req);
      expect(res.status).toBe(404);
    });

    it('allows access when flag is internal and user is listed', async () => {
      vi.mocked(perfFlagsModule.getPerfFlags).mockResolvedValue(INTERNAL_PERF_FLAGS);
      vi.mocked(sessionServiceModule.listSessions).mockResolvedValue({
        sessions: [],
        nextCursor: null,
      });

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions');
      const res = await listSessionsHandler(req);
      expect(res.status).toBe(200);
    });
  });

  describe('Rate Limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      vi.mocked(rateLimitModule.consumeSessionRateLimit).mockRejectedValueOnce(
        new RateLimitError({ windowStart: new Date().toISOString(), retryAfter: 60 }),
      );

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions');
      const res = await listSessionsHandler(req);
      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.code).toBe('RATE_LIMITED');
    });
  });

  describe('GET /api/recommend/sessions', () => {
    it('returns 400 for invalid query parameters', async () => {
      const req = createMockRequest('http://localhost:3000/api/recommend/sessions?limit=100');
      const res = await listSessionsHandler(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION');
    });

    it('returns paginated sessions list with pinned sessions on first page', async () => {
      vi.mocked(sessionServiceModule.listSessions).mockResolvedValue({
        pinned: [
          {
            id: 'pin-1',
            title: 'Pinned phone search',
            titleSource: 'user',
            firstMessage: null,
            isPinned: true,
            status: 'active',
            turnCount: 2,
            topPick: null,
            createdAt: '2026-10-21T10:00:00.000Z',
            lastTurnAt: '2026-10-21T10:05:00.000Z',
          },
        ],
        sessions: [
          {
            id: TEST_SESSION_ID,
            title: 'Budget gaming',
            titleSource: 'heuristic',
            firstMessage: null,
            isPinned: false,
            status: 'active',
            turnCount: 1,
            topPick: null,
            createdAt: '2026-10-22T10:00:00.000Z',
            lastTurnAt: '2026-10-22T10:05:00.000Z',
          },
        ],
        nextCursor: 'next-cursor-token',
        guestImportAvailable: 3,
      });

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions?limit=10');
      const res = await listSessionsHandler(req);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pinned).toHaveLength(1);
      expect(body.sessions).toHaveLength(1);
      expect(body.nextCursor).toBe('next-cursor-token');
      expect(body.guestImportAvailable).toBe(3);
    });
  });

  describe('POST /api/recommend/sessions', () => {
    it('returns 403 on cross-origin request', async () => {
      const req = createMockRequest('http://localhost:3000/api/recommend/sessions', {
        method: 'POST',
        headers: { origin: 'https://evil.attacker.com', 'sec-fetch-site': 'cross-site' },
      });
      const res = await createSessionHandler(req);
      expect(res.status).toBe(403);
    });

    it('returns 400 on malformed JSON body', async () => {
      const req = createMockRequest('http://localhost:3000/api/recommend/sessions', {
        method: 'POST',
        body: 'invalid-json{',
      });
      const res = await createSessionHandler(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION');
    });

    it('creates a new session and returns 201', async () => {
      vi.mocked(sessionServiceModule.resolveOrCreateSession).mockResolvedValue({
        session: {
          id: TEST_SESSION_ID,
          title: 'New Recommendation',
          titleSource: 'default',
          status: 'active',
          turnCount: 0,
        },
        created: true,
      });

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions', {
        method: 'POST',
        body: JSON.stringify({ id: TEST_SESSION_ID }),
      });
      const res = await createSessionHandler(req);
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.session.id).toBe(TEST_SESSION_ID);
      expect(body.created).toBe(true);
    });
  });

  describe('GET /api/recommend/sessions/:id', () => {
    it('returns 404 for invalid UUID id', async () => {
      const req = createMockRequest('http://localhost:3000/api/recommend/sessions/not-a-uuid');
      const res = await getDetailHandler(req, {
        params: Promise.resolve({ id: 'not-a-uuid' }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe('NOT_FOUND');
    });

    it('returns 404 when session detail is not found or not owned', async () => {
      vi.mocked(sessionServiceModule.getSessionDetail).mockResolvedValue(null);

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
      );
      const res = await getDetailHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(404);
    });

    it('returns session detail and turns on success', async () => {
      vi.mocked(sessionServiceModule.getSessionDetail).mockResolvedValue({
        id: TEST_SESSION_ID,
        title: 'Pixel Phone Search',
        titleSource: 'heuristic',
        firstMessage: null,
        isPinned: false,
        status: 'active',
        turnCount: 1,
        topPick: null,
        createdAt: '2026-10-22T10:00:00.000Z',
        lastTurnAt: '2026-10-22T10:05:00.000Z',
        turns: [
          {
            id: 'turn-1',
            turnIndex: 0,
            userMessage: 'need a great camera',
            intent: 'recommend',
            clarifyingQuestion: null,
            picks: [{ brand: 'Google', model: 'Pixel 9' }],
            resultMeta: null,
            createdAt: '2026-10-22T10:00:00.000Z',
          },
        ],
      });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
      );
      const res = await getDetailHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.session.title).toBe('Pixel Phone Search');
      expect(body.session.turns).toHaveLength(1);
    });
  });

  describe('PATCH /api/recommend/sessions/:id', () => {
    it('returns 403 on cross-origin request', async () => {
      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'PATCH',
          headers: { origin: 'https://evil.attacker.com', 'sec-fetch-site': 'cross-site' },
          body: JSON.stringify({ isPinned: true }),
        },
      );
      const res = await updateSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 400 when no fields are provided to update', async () => {
      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({}),
        },
      );
      const res = await updateSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe('VALIDATION');
    });

    it('returns 409 when pin limit (50) is exceeded', async () => {
      vi.mocked(sessionServiceModule.updateSession).mockResolvedValue({
        session: null,
        error: 'PIN_LIMIT_EXCEEDED',
      });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ isPinned: true }),
        },
      );
      const res = await updateSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('PIN_LIMIT_EXCEEDED');
    });

    it('returns 404 when session to update is not found', async () => {
      vi.mocked(sessionServiceModule.updateSession).mockResolvedValue({
        session: null,
      });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: 'New Renamed Title' }),
        },
      );
      const res = await updateSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(404);
    });

    it('updates session and returns 200 with updated summary', async () => {
      vi.mocked(sessionServiceModule.updateSession).mockResolvedValue({
        session: {
          id: TEST_SESSION_ID,
          title: 'My Custom Title',
          titleSource: 'user',
          firstMessage: null,
          isPinned: true,
          status: 'active',
          turnCount: 1,
          topPick: null,
          createdAt: '2026-10-22T10:00:00.000Z',
          lastTurnAt: '2026-10-22T10:05:00.000Z',
        },
      });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ title: 'My Custom Title', isPinned: true }),
        },
      );
      const res = await updateSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.session.title).toBe('My Custom Title');
      expect(body.session.isPinned).toBe(true);
    });
  });

  describe('DELETE /api/recommend/sessions/:id', () => {
    it('returns 403 on cross-origin request', async () => {
      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'DELETE',
          headers: { origin: 'https://evil.attacker.com', 'sec-fetch-site': 'cross-site' },
        },
      );
      const res = await deleteSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when session not found or already deleted', async () => {
      vi.mocked(sessionServiceModule.softDeleteSession).mockResolvedValue({ deleted: false });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'DELETE',
        },
      );
      const res = await deleteSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(404);
    });

    it('soft deletes session and returns 200', async () => {
      vi.mocked(sessionServiceModule.softDeleteSession).mockResolvedValue({ deleted: true });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}`,
        {
          method: 'DELETE',
        },
      );
      const res = await deleteSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.id).toBe(TEST_SESSION_ID);
    });
  });

  describe('POST /api/recommend/sessions/:id/restore', () => {
    it('returns 403 on cross-origin request', async () => {
      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}/restore`,
        {
          method: 'POST',
          headers: { origin: 'https://evil.attacker.com', 'sec-fetch-site': 'cross-site' },
        },
      );
      const res = await restoreSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 when session cannot be restored', async () => {
      vi.mocked(sessionServiceModule.restoreSession).mockResolvedValue({ restored: false });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}/restore`,
        {
          method: 'POST',
        },
      );
      const res = await restoreSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(404);
    });

    it('restores soft-deleted session and returns 200', async () => {
      vi.mocked(sessionServiceModule.restoreSession).mockResolvedValue({ restored: true });

      const req = createMockRequest(
        `http://localhost:3000/api/recommend/sessions/${TEST_SESSION_ID}/restore`,
        {
          method: 'POST',
        },
      );
      const res = await restoreSessionHandler(req, {
        params: Promise.resolve({ id: TEST_SESSION_ID }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.id).toBe(TEST_SESSION_ID);
    });
  });

  describe('POST /api/recommend/sessions/claim', () => {
    it('returns 403 on cross-origin request', async () => {
      const req = createMockRequest('http://localhost:3000/api/recommend/sessions/claim', {
        method: 'POST',
        headers: { origin: 'https://evil.attacker.com', 'sec-fetch-site': 'cross-site' },
      });
      const res = await claimSessionsHandler(req);
      expect(res.status).toBe(403);
    });

    it('returns 401 when caller is unauthenticated', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: null,
        deviceId: TEST_DEVICE_ID,
        isSuspended: false,
      } as unknown as identityModule.RequestIdentity);

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions/claim', {
        method: 'POST',
      });
      const res = await claimSessionsHandler(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.code).toBe('UNAUTHORIZED');
    });

    it('returns 0 claimed when device cookie is missing or nocookie', async () => {
      vi.mocked(identityModule.resolveRequestIdentity).mockResolvedValue({
        userId: TEST_USER_ID,
        deviceId: 'nocookie:127.0.0.1',
        isSuspended: false,
      } as unknown as identityModule.RequestIdentity);

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions/claim', {
        method: 'POST',
      });
      const res = await claimSessionsHandler(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.claimed).toBe(0);
    });

    it('claims guest sessions and returns claimed count', async () => {
      vi.mocked(sessionServiceModule.claimGuestSessions).mockResolvedValue({ claimed: 2 });

      const req = createMockRequest('http://localhost:3000/api/recommend/sessions/claim', {
        method: 'POST',
        body: JSON.stringify({ sessionIds: [TEST_SESSION_ID] }),
      });
      const res = await claimSessionsHandler(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.claimed).toBe(2);
      expect(sessionServiceModule.claimGuestSessions).toHaveBeenCalledWith(
        expect.anything(),
        TEST_USER_ID,
        TEST_DEVICE_ID,
        [TEST_SESSION_ID],
      );
    });
  });
});

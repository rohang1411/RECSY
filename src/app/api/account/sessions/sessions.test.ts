import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, DELETE } from './route';
import {
  formatDeviceMarker,
  listUserSessions,
  getUserSessionDetail,
  deleteUserSession,
} from '@/services/account/sessions';
import { AppError } from '@/lib/errors';
import * as profileModule from '@/services/auth/profile';
import type { RequestIdentity } from '@/services/auth/identity';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn().mockReturnValue({}),
}));
vi.mock('@/services/auth/profile');
vi.mock('@/services/account/sessions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listUserSessions: vi.fn(),
    getUserSessionDetail: vi.fn(),
    deleteUserSession: vi.fn(),
  };
});

describe('Account Sessions Service & Route (WP-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatDeviceMarker', () => {
    it('identifies Chrome on Windows', () => {
      const ua =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';
      expect(formatDeviceMarker(ua)).toBe('Chrome on Windows');
    });

    it('identifies Safari on iOS', () => {
      const ua =
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
      expect(formatDeviceMarker(ua)).toBe('Safari on iOS');
    });

    it('identifies Firefox on Linux', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0';
      expect(formatDeviceMarker(ua)).toBe('Firefox on Linux');
    });

    it('returns undefined for empty user agent', () => {
      expect(formatDeviceMarker(null)).toBeUndefined();
      expect(formatDeviceMarker(undefined)).toBeUndefined();
    });
  });

  describe('GET /api/account/sessions', () => {
    it('returns 401 when unauthenticated', async () => {
      vi.mocked(profileModule.requireUser).mockRejectedValue(
        new AppError('UNAUTHORIZED', 'Sign-in required', { status: 401 }),
      );

      const request = new NextRequest('http://localhost:3000/api/account/sessions');
      const response = await GET(request);
      expect(response.status).toBe(401);
    });

    it('lists sessions with cursor pagination', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: 'user-123',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.mocked(listUserSessions).mockResolvedValue({
        sessions: [
          {
            id: 'sess-1',
            title: 'Flagship with good zoom',
            createdAt: '2026-10-21T10:00:00.000Z',
            updatedAt: '2026-10-21T10:05:00.000Z',
            deviceMarker: 'Chrome on Windows',
            turnsCount: 2,
          },
        ],
        nextCursor: null,
      });

      const request = new NextRequest('http://localhost:3000/api/account/sessions');
      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.sessions).toHaveLength(1);
      expect(body.sessions[0].title).toBe('Flagship with good zoom');
      expect(body.sessions[0].deviceMarker).toBe('Chrome on Windows');
      expect(body.nextCursor).toBeNull();
    });

    it('retrieves single session detail when id is provided', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: 'user-123',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.mocked(getUserSessionDetail).mockResolvedValue({
        id: '99999999-9999-4999-8999-999999999999',
        title: 'Compact phones',
        createdAt: '2026-10-21T10:00:00.000Z',
        updatedAt: '2026-10-21T10:05:00.000Z',
        deviceMarker: 'Safari on iOS',
        turnsCount: 1,
        turns: [
          {
            id: 'turn-1',
            turnIndex: 0,
            userMessage: 'small phones under 6.1 inches',
            intent: 'recommend',
            extractedRequirements: {},
            picks: [],
            clarifyingQuestion: null,
            createdAt: '2026-10-21T10:00:00.000Z',
          },
        ],
      });

      const request = new NextRequest(
        'http://localhost:3000/api/account/sessions?id=99999999-9999-4999-8999-999999999999',
      );
      const response = await GET(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.session.id).toBe('99999999-9999-4999-8999-999999999999');
      expect(body.session.turns).toHaveLength(1);
    });

    it('returns 404 when single session not found', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: 'user-123',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.mocked(getUserSessionDetail).mockResolvedValue(null);

      const request = new NextRequest(
        'http://localhost:3000/api/account/sessions?id=00000000-0000-4000-8000-000000000000',
      );
      const response = await GET(request);
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/account/sessions', () => {
    it('deletes session when owned', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: 'user-123',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.mocked(deleteUserSession).mockResolvedValue({ deleted: true });

      const request = new NextRequest('http://localhost:3000/api/account/sessions?id=sess-1', {
        method: 'DELETE',
      });
      const response = await DELETE(request);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(body.id).toBe('sess-1');
    });

    it('returns 404 if session not owned or already gone', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: 'user-123',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.mocked(deleteUserSession).mockResolvedValue({ deleted: false });

      const request = new NextRequest(
        'http://localhost:3000/api/account/sessions?id=sess-missing',
        {
          method: 'DELETE',
        },
      );
      const response = await DELETE(request);
      expect(response.status).toBe(404);
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { POST as exportAccount } from './export/route';
import { POST as deleteAccount } from './delete/route';
import { POST as cancelDelete } from './delete/cancel/route';
import { POST as deleteHistory } from './history/delete/route';
import { runAccountMaintenance } from '@/../scripts/account-maintenance';
import { getDb } from '@/services/db/client';
import * as profileModule from '@/services/auth/profile';
import { fakeEmailDriver } from '@/services/email/driver';
import { UnauthorizedError } from '@/lib/errors';

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

vi.mock('@/services/auth/profile', async (importOriginal) => {
  const actual = await importOriginal<typeof profileModule>();
  return {
    ...actual,
    requireUser: vi.fn(),
    getUserProfile: vi.fn(),
  };
});

describe('WP-11: Account Lifecycle and Maintenance APIs', () => {
  const testUserId = '00000000-0000-4000-8000-000000000001';

  const mockDb = {
    execute: vi.fn(),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ count: 1 }]),
        }),
      }),
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    fakeEmailDriver.clear();
    vi.mocked(getDb).mockReturnValue(mockDb as unknown as ReturnType<typeof getDb>);
  });

  describe('POST /api/account/export', () => {
    it('rejects cross-origin request with 403 BAD_ORIGIN', async () => {
      const request = new NextRequest('http://localhost:3000/api/account/export', {
        method: 'POST',
        headers: {
          origin: 'https://malicious.evil.com',
          host: 'localhost:3000',
        },
      });

      const res = await exportAccount(request);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('BAD_ORIGIN');
    });

    it('rejects unauthenticated request with 401 UNAUTHORIZED', async () => {
      vi.mocked(profileModule.requireUser).mockRejectedValue(
        new UnauthorizedError('Authentication required'),
      );

      const request = new NextRequest('http://localhost:3000/api/account/export', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
      });

      const res = await exportAccount(request);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.code).toBe('UNAUTHORIZED');
    });

    it('returns JSON attachment on success with all user data categories', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: testUserId,
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      vi.mocked(profileModule.getUserProfile).mockResolvedValue({
        id: testUserId,
        email: 'user@example.com',
        display_name: 'Test User',
        avatar_url: null,
        country: 'US',
        locale: 'en',
        terms_version: '2026-10',
        terms_accepted_at: new Date('2026-10-01'),
        marketing_opt_in: true,
        status: 'active',
        billing_hold: false,
        created_at: new Date('2026-10-01'),
        updated_at: new Date('2026-10-15'),
        last_seen_at: new Date(),
        deletion_requested_at: null,
        email_normalized: 'user@example.com',
      });

      // DB queries: sessions, turns, chats, ledger, orders, subscriptions, usage
      mockDb.execute
        .mockResolvedValueOnce([
          { id: 's1', title: 'Session 1', created_at: new Date(), updated_at: new Date() },
        ]) // sessions
        .mockResolvedValueOnce([]) // turns
        .mockResolvedValueOnce([
          { id: 'c1', phone_id: 'p1', query: 'battery specs?', created_at: new Date() },
        ]) // chats
        .mockResolvedValueOnce([
          { id: 'l1', created_at: new Date(), delta: 25, balance_after: 25, kind: 'purchase' },
        ]) // ledger
        .mockResolvedValueOnce([]) // orders
        .mockResolvedValueOnce([]) // subscriptions
        .mockResolvedValueOnce([
          { usage_date: '2026-10-21', free_used: 1, total_used: 1, byok_used: 0 },
        ]); // usage

      const request = new NextRequest('http://localhost:3000/api/account/export', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
      });

      const res = await exportAccount(request);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(res.headers.get('content-disposition')).toContain(
        'attachment; filename="recsy-export-',
      );

      const json = await res.json();
      expect(json.profile.email).toBe('user@example.com');
      expect(json.consents.termsVersion).toBe('2026-10');
      expect(json.sessions).toHaveLength(1);
      expect(json.chatQueries).toHaveLength(1);
      expect(json.creditLedger).toHaveLength(1);
      expect(json.usageSummary).toHaveLength(1);
    });
  });

  describe('POST /api/account/delete', () => {
    it('rejects with 400 when confirm is not DELETE', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: testUserId,
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      const request = new NextRequest('http://localhost:3000/api/account/delete', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'NO' }),
      });

      const res = await deleteAccount(request);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe('VALIDATION');
    });

    it('rejects with 409 BILLING_HOLD when billing_hold is active', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: testUserId,
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      vi.mocked(profileModule.getUserProfile).mockResolvedValue({
        id: testUserId,
        email: 'user@example.com',
        billing_hold: true,
      } as unknown as profileModule.UserProfileRow);

      const request = new NextRequest('http://localhost:3000/api/account/delete', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });

      const res = await deleteAccount(request);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.code).toBe('BILLING_HOLD');
    });

    it('successfully queues deletion with 30-day cooling period and sends email', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: testUserId,
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      vi.mocked(profileModule.getUserProfile).mockResolvedValue({
        id: testUserId,
        email: 'user@example.com',
        billing_hold: false,
      } as unknown as profileModule.UserProfileRow);

      mockDb.execute.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/account/delete', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });

      const res = await deleteAccount(request);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('pending_deletion');
      expect(json.executeAfter).toBeDefined();

      expect(fakeEmailDriver.sentMessages).toHaveLength(1);
      expect(fakeEmailDriver.sentMessages[0]?.to).toBe('user@example.com');
      expect(fakeEmailDriver.sentMessages[0]?.subject).toContain('Deletion Scheduled');
    });
  });

  describe('POST /api/account/delete/cancel', () => {
    it('restores account status to active and sends cancellation confirmation email', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: testUserId,
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      vi.mocked(profileModule.getUserProfile).mockResolvedValue({
        id: testUserId,
        email: 'user@example.com',
      } as unknown as profileModule.UserProfileRow);

      mockDb.execute.mockResolvedValue([]);

      const request = new NextRequest('http://localhost:3000/api/account/delete/cancel', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
        },
      });

      const res = await cancelDelete(request);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe('active');

      expect(fakeEmailDriver.sentMessages).toHaveLength(1);
      expect(fakeEmailDriver.sentMessages[0]?.subject).toContain('Deletion Cancelled');
    });
  });

  describe('POST /api/account/history/delete', () => {
    it('deletes recommendation clients and chat queries', async () => {
      vi.mocked(profileModule.requireUser).mockResolvedValue({
        userId: testUserId,
        emailVerified: true,
        deviceId: 'dev_123',
        deviceCookieIsNew: false,
        ipKey: 'ip_key',
        ipHashForRateLimit: 'hash',
        isSuspended: false,
      });

      mockDb.execute
        .mockResolvedValueOnce([{ count: 3 }]) // clients deleted
        .mockResolvedValueOnce([{ count: 5 }]); // chats deleted

      const request = new NextRequest('http://localhost:3000/api/account/history/delete', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          host: 'localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ scope: 'all' }),
      });

      const res = await deleteHistory(request);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deleted).toBe(8);
    });
  });

  describe('scripts/account-maintenance.ts', () => {
    it('sweeps due account deletions and executes them', async () => {
      vi.mocked(profileModule.getUserProfile).mockResolvedValue({
        id: testUserId,
        email: 'user@example.com',
        billing_hold: false,
      } as unknown as profileModule.UserProfileRow);

      mockDb.execute
        .mockResolvedValueOnce([{ id: 'req_1', user_id: testUserId, execute_after: new Date() }]) // due requests
        .mockResolvedValueOnce([]) // clients
        .mockResolvedValueOnce([]) // chats
        .mockResolvedValueOnce([]) // billing_customers
        .mockResolvedValueOnce([]) // user_profiles
        .mockResolvedValueOnce([]); // update account_requests

      const result = await runAccountMaintenance();
      expect(result.processed).toBe(1);
      expect(result.failed).toBe(0);
    });
  });
});

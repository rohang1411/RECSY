import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET, PATCH } from './route';
import * as dbModule from '@/services/db/client';
import * as identityModule from '@/services/auth/identity';
import type { RequestIdentity } from '@/services/auth/identity';
import * as profileModule from '@/services/auth/profile';

describe('/api/me/profile', () => {
  const mockDb = {
    execute: vi.fn(),
  } as unknown as ReturnType<typeof dbModule.getDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);
  });

  describe('GET /api/me/profile', () => {
    it('returns 401 when anonymous', async () => {
      vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValue({
        userId: null,
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      const req = {} as NextRequest;
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    it('returns 200 with formatted profile when authenticated', async () => {
      vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValue({
        userId: 'u1',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.spyOn(profileModule, 'getUserProfile').mockResolvedValue({
        id: 'u1',
        email: 'rohan@example.com',
        email_normalized: 'rohan@example.com',
        display_name: 'Rohan Sharma',
        avatar_url: 'https://example.com/avatar.jpg',
        date_of_birth: '1998-05-15',
        country: 'US',
        locale: 'en',
        terms_version: '2026-10',
        terms_accepted_at: new Date(),
        marketing_opt_in: false,
        status: 'active',
        billing_hold: false,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-01'),
        last_seen_at: new Date(),
        deletion_requested_at: null,
      });

      const req = {} as NextRequest;
      const res = await GET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.email).toBe('rohan@example.com');
      expect(json.firstName).toBe('Rohan');
      expect(json.lastName).toBe('Sharma');
      expect(json.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(json.dateOfBirth).toBe('1998-05-15');
    });
  });

  describe('PATCH /api/me/profile', () => {
    it('returns 403 when cross-origin request is detected (CSRF protection)', async () => {
      const req = {
        headers: {
          get: (name: string) => {
            if (name.toLowerCase() === 'origin') return 'https://malicious-attacker.com';
            if (name.toLowerCase() === 'host') return 'recsy.com';
            return null;
          },
        },
        json: vi.fn().mockResolvedValue({ displayName: 'Hacked' }),
      } as unknown as NextRequest;

      const res = await PATCH(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toContain('Cross-origin request forbidden');
    });
    it('returns 400 on invalid date of birth format', async () => {
      vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValue({
        userId: 'u1',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      const req = {
        json: vi.fn().mockResolvedValue({ dateOfBirth: 'invalid-date' }),
      } as unknown as NextRequest;

      const res = await PATCH(req);
      expect(res.status).toBe(400);
    });

    it('updates profile and returns 200 on valid payload', async () => {
      vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValue({
        userId: 'u1',
        deviceId: 'dev-1',
        isSuspended: false,
      } as unknown as RequestIdentity);

      vi.spyOn(profileModule, 'updateUserProfile').mockResolvedValue({
        id: 'u1',
        email: 'rohan@example.com',
        email_normalized: 'rohan@example.com',
        display_name: 'Rohan S.',
        avatar_url: null,
        date_of_birth: '1998-05-15',
        country: 'US',
        locale: 'en',
        terms_version: '2026-10',
        terms_accepted_at: new Date(),
        marketing_opt_in: false,
        status: 'active',
        billing_hold: false,
        created_at: new Date('2026-01-01'),
        updated_at: new Date('2026-01-02'),
        last_seen_at: new Date(),
        deletion_requested_at: null,
      });

      const req = {
        json: vi.fn().mockResolvedValue({ displayName: 'Rohan S.', dateOfBirth: '1998-05-15' }),
      } as unknown as NextRequest;

      const res = await PATCH(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.displayName).toBe('Rohan S.');
      expect(json.firstName).toBe('Rohan');
    });
  });
});

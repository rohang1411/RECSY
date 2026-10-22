import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { POST as signIn } from './signin/route';
import { POST as signUp } from './signup/route';
import * as serverModule from '@/services/auth/supabase-server';
import * as dbModule from '@/services/db/client';
import * as identityModule from '@/services/auth/identity';
import type { RequestIdentity } from '@/services/auth/identity';
import * as profileModule from '@/services/auth/profile';

describe('Password Authentication Routes', () => {
  const mockExecute = vi.fn();
  const mockDb = {
    execute: mockExecute,
  } as unknown as ReturnType<typeof dbModule.getDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb);
    vi.spyOn(identityModule, 'resolveRequestIdentity').mockResolvedValue({
      userId: 'test-user-id',
      deviceId: 'dev-1',
      isSuspended: false,
    } as unknown as RequestIdentity);
    vi.spyOn(profileModule, 'ensureUserProfile').mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      email_normalized: 'test@example.com',
    });
  });

  describe('POST /auth/password/signin', () => {
    it('returns 400 when email or password is missing', async () => {
      const req = {
        json: vi.fn().mockResolvedValue({ email: 'bad-email' }),
        cookies: { get: vi.fn() },
      } as unknown as NextRequest;

      const res = await signIn(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.ok).toBe(false);
    });

    it('returns 404 with user_not_found when user does not exist', async () => {
      const mockClient = {
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: { user: null },
            error: { message: 'Invalid login credentials' },
          }),
        },
      };
      vi.spyOn(serverModule, 'createSupabaseServerClient').mockResolvedValue(
        mockClient as unknown as ReturnType<typeof serverModule.createSupabaseServerClient>,
      );
      mockExecute.mockResolvedValueOnce([]); // No user in user_profiles

      const req = {
        json: vi.fn().mockResolvedValue({ email: 'unknown@example.com', password: 'password123' }),
        cookies: { get: vi.fn() },
      } as unknown as NextRequest;

      const res = await signIn(req);
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe('user_not_found');
    });

    it('returns 200 on successful password authentication', async () => {
      const mockClient = {
        auth: {
          signInWithPassword: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '00000000-0000-4000-8000-000000000001',
                email: 'user@example.com',
                user_metadata: { full_name: 'Test User' },
              },
            },
            error: null,
          }),
        },
      };
      vi.spyOn(serverModule, 'createSupabaseServerClient').mockResolvedValue(
        mockClient as unknown as ReturnType<typeof serverModule.createSupabaseServerClient>,
      );

      const req = {
        json: vi.fn().mockResolvedValue({ email: 'user@example.com', password: 'password123' }),
        cookies: { get: vi.fn() },
      } as unknown as NextRequest;

      const res = await signIn(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.user.id).toBe('00000000-0000-4000-8000-000000000001');
    });
  });

  describe('POST /auth/password/signup', () => {
    it('returns 409 when user email already exists', async () => {
      mockExecute.mockResolvedValueOnce([{ id: 'existing-id' }]);

      const req = {
        json: vi.fn().mockResolvedValue({
          fullName: 'Test User',
          email: 'existing@example.com',
          password: 'password123',
        }),
        cookies: { get: vi.fn() },
      } as unknown as NextRequest;

      const res = await signUp(req);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toBe('user_exists');
    });

    it('creates account and returns 200 on valid signup', async () => {
      mockExecute.mockResolvedValueOnce([]); // No existing user
      const mockClient = {
        auth: {
          signUp: vi.fn().mockResolvedValue({
            data: {
              user: {
                id: '00000000-0000-4000-8000-000000000002',
                email: 'newuser@example.com',
                user_metadata: { full_name: 'New User' },
              },
              session: { access_token: 'tok' },
            },
            error: null,
          }),
        },
      };
      vi.spyOn(serverModule, 'createSupabaseServerClient').mockResolvedValue(
        mockClient as unknown as ReturnType<typeof serverModule.createSupabaseServerClient>,
      );

      const req = {
        json: vi.fn().mockResolvedValue({
          fullName: 'New User',
          email: 'newuser@example.com',
          password: 'password123',
          dateOfBirth: '1995-10-15',
        }),
        cookies: { get: vi.fn() },
      } as unknown as NextRequest;

      const res = await signUp(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.user.displayName).toBe('New User');
    });
  });
});

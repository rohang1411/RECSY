import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  getVerifiedClaimsWithTimeout,
  getVerifiedUserWithTimeout,
  type SupabaseServerClient,
} from './supabase-server';

describe('supabase-server auth verification helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getVerifiedClaimsWithTimeout', () => {
    it('returns user id and emailVerified when valid claims are returned', async () => {
      const mockClient = {
        auth: {
          getClaims: vi.fn().mockResolvedValue({
            data: {
              claims: {
                sub: 'user-uuid-123',
                user_metadata: { email_verified: true },
              },
            },
            error: null,
          }),
        },
      } as unknown as SupabaseServerClient;

      const result = await getVerifiedClaimsWithTimeout(mockClient, 500);
      expect(result).toEqual({
        id: 'user-uuid-123',
        emailVerified: true,
      });
    });

    it('returns emailVerified=false when user_metadata.email_verified is not true', async () => {
      const mockClient = {
        auth: {
          getClaims: vi.fn().mockResolvedValue({
            data: {
              claims: {
                sub: 'user-uuid-456',
                user_metadata: {},
              },
            },
            error: null,
          }),
        },
      } as unknown as SupabaseServerClient;

      const result = await getVerifiedClaimsWithTimeout(mockClient, 500);
      expect(result).toEqual({
        id: 'user-uuid-456',
        emailVerified: false,
      });
    });

    it('returns null when claims data is missing or sub is absent', async () => {
      const mockClient = {
        auth: {
          getClaims: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        },
      } as unknown as SupabaseServerClient;

      const result = await getVerifiedClaimsWithTimeout(mockClient, 500);
      expect(result).toBeNull();
    });

    it('returns null when getClaims returns an error (expired or malformed token)', async () => {
      const mockClient = {
        auth: {
          getClaims: vi.fn().mockResolvedValue({
            data: null,
            error: new Error('Token expired'),
          }),
        },
      } as unknown as SupabaseServerClient;

      const result = await getVerifiedClaimsWithTimeout(mockClient, 500);
      expect(result).toBeNull();
    });

    it('throws AUTH_TIMEOUT when getClaims exceeds the timeout deadline', async () => {
      const mockClient = {
        auth: {
          getClaims: vi
            .fn()
            .mockImplementation(
              () =>
                new Promise((resolve) =>
                  setTimeout(() => resolve({ data: null, error: null }), 200),
                ),
            ),
        },
      } as unknown as SupabaseServerClient;

      await expect(getVerifiedClaimsWithTimeout(mockClient, 20)).rejects.toThrow('AUTH_TIMEOUT');
    });
  });

  describe('getVerifiedUserWithTimeout', () => {
    it('returns user when client.auth.getUser succeeds', async () => {
      const mockUser = { id: 'user-789', email_confirmed_at: '2026-01-01' };
      const mockClient = {
        auth: {
          getUser: vi.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
        },
      } as unknown as SupabaseServerClient;

      const result = await getVerifiedUserWithTimeout(mockClient, 500);
      expect(result).toEqual(mockUser);
    });

    it('throws AUTH_TIMEOUT when getUser exceeds timeout', async () => {
      const mockClient = {
        auth: {
          getUser: vi
            .fn()
            .mockImplementation(
              () =>
                new Promise((resolve) => setTimeout(() => resolve({ data: { user: null } }), 200)),
            ),
        },
      } as unknown as SupabaseServerClient;

      await expect(getVerifiedUserWithTimeout(mockClient, 20)).rejects.toThrow('AUTH_TIMEOUT');
    });
  });
});

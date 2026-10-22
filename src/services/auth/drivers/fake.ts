import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import type { AuthDriver, AuthResultUser, SignInWithOtpInput, VerifyOtpInput } from '../driver';
import type { SupabaseServerClient } from '../supabase-server';
import { env } from '@/env';
import { isHostedDatabaseUrl } from '@/services/eval/workload-guard';

export const FAKE_AUTH_COOKIE_NAME = 'recsy_fake_uid';

/**
 * Validates that FakeAuthDriver is only instantiated in safe local environments.
 * Rejects production, public hostnames, and hosted databases.
 */
export function assertFakeAuthAllowed(options?: {
  siteUrl?: string;
  databaseUrl?: string;
  nodeEnv?: string;
}): void {
  const siteUrl = options?.siteUrl ?? env.NEXT_PUBLIC_SITE_URL;
  const databaseUrl = options?.databaseUrl ?? env.DATABASE_URL;
  const nodeEnv = options?.nodeEnv ?? env.NODE_ENV;

  if (nodeEnv === 'production') {
    throw new Error('FakeAuthDriver is forbidden in production environment');
  }

  try {
    const parsed = new URL(siteUrl);
    const host = parsed.hostname.toLowerCase();
    if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
      throw new Error(`FakeAuthDriver requires localhost site URL, got: ${siteUrl}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('FakeAuthDriver')) throw err;
    throw new Error(`FakeAuthDriver invalid site URL: ${siteUrl}`);
  }

  if (isHostedDatabaseUrl(databaseUrl)) {
    throw new Error('FakeAuthDriver is forbidden against hosted database URLs');
  }
}

export class FakeAuthDriver implements AuthDriver {
  constructor() {
    assertFakeAuthAllowed();
  }

  async getGoogleOAuthUrl(
    returnTo = '/',
    options?: { siteUrl?: string; client?: SupabaseServerClient },
  ): Promise<string> {
    const fakeId = randomUUID();
    const cookieStore = await cookies();
    cookieStore.set(FAKE_AUTH_COOKIE_NAME, fakeId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    const baseUrl = options?.siteUrl
      ? options.siteUrl.replace(/\/$/, '')
      : env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    return `${baseUrl}/auth/callback?fake_uid=${fakeId}&next=${encodeURIComponent(returnTo)}`;
  }

  async sendOtp(_input: SignInWithOtpInput): Promise<{ sent: boolean }> {
    return { sent: true };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<{ user: AuthResultUser | null }> {
    const fakeId = randomUUID();
    const cookieStore = await cookies();
    cookieStore.set(FAKE_AUTH_COOKIE_NAME, fakeId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });

    return {
      user: {
        id: fakeId,
        email: input.email.trim(),
        user_metadata: {
          full_name: 'Test User',
          terms_version: '2026-10',
        },
      },
    };
  }

  async signOut(_options?: { client?: SupabaseServerClient }): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.delete(FAKE_AUTH_COOKIE_NAME);
  }
}

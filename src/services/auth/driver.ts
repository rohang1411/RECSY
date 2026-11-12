import { env } from '@/env';
import { SupabaseAuthDriver } from './drivers/supabase';
import { FakeAuthDriver } from './drivers/fake';
import type { SupabaseServerClient } from './supabase-server';

export interface SignInWithOtpInput {
  readonly email: string;
  readonly captchaToken?: string;
  readonly returnTo?: string;
  readonly siteUrl?: string;
  readonly client?: SupabaseServerClient;
}

export interface VerifyOtpInput {
  readonly email: string;
  readonly token: string;
  readonly type?: 'email' | 'magiclink';
  readonly client?: SupabaseServerClient;
}

export interface AuthResultUser {
  readonly id: string;
  readonly email: string;
  readonly user_metadata?: Record<string, unknown>;
}

export interface AuthDriver {
  getGoogleOAuthUrl(
    returnTo?: string,
    options?: { siteUrl?: string; client?: SupabaseServerClient },
  ): Promise<string>;
  sendOtp(input: SignInWithOtpInput): Promise<{ sent: boolean }>;
  verifyOtp(input: VerifyOtpInput): Promise<{
    user: AuthResultUser | null;
  }>;
  signOut(options?: { client?: SupabaseServerClient }): Promise<void>;
}

export function getAuthDriver(): AuthDriver {
  if (env.AUTH_DRIVER === 'fake') {
    return new FakeAuthDriver();
  }
  return new SupabaseAuthDriver();
}

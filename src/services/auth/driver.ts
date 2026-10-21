import { env } from '@/env';
import { SupabaseAuthDriver } from './drivers/supabase';
import { FakeAuthDriver } from './drivers/fake';

export interface SignInWithOtpInput {
  readonly email: string;
  readonly captchaToken?: string;
  readonly returnTo?: string;
}

export interface VerifyOtpInput {
  readonly email: string;
  readonly token: string;
  readonly type?: 'email' | 'magiclink';
}

export interface AuthResultUser {
  readonly id: string;
  readonly email: string;
  readonly user_metadata?: Record<string, unknown>;
}

export interface AuthDriver {
  getGoogleOAuthUrl(returnTo?: string): Promise<string>;
  sendOtp(input: SignInWithOtpInput): Promise<{ sent: boolean }>;
  verifyOtp(input: VerifyOtpInput): Promise<{
    user: AuthResultUser | null;
  }>;
  signOut(): Promise<void>;
}

export function getAuthDriver(): AuthDriver {
  if (env.AUTH_DRIVER === 'fake') {
    return new FakeAuthDriver();
  }
  return new SupabaseAuthDriver();
}

import type { AuthDriver, AuthResultUser, SignInWithOtpInput, VerifyOtpInput } from '../driver';
import { createSupabaseServerClient, type SupabaseServerClient } from '../supabase-server';
import { safeReturnTo } from '../return-to';
import { env } from '@/env';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'supabase-auth-driver' });

export class SupabaseAuthDriver implements AuthDriver {
  async getGoogleOAuthUrl(
    returnTo = '/',
    options?: { siteUrl?: string; client?: SupabaseServerClient },
  ): Promise<string> {
    const client = options?.client ?? (await createSupabaseServerClient());
    const sanitizedReturn = safeReturnTo(returnTo);
    const baseUrl = options?.siteUrl
      ? options.siteUrl.replace(/\/$/, '')
      : env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    const redirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(sanitizedReturn)}`;

    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    });

    if (error || !data.url) {
      log.error({ error }, 'failed to initialize Google OAuth via Supabase');
      throw new Error(`Failed to initialize Google OAuth: ${error?.message ?? 'no URL returned'}`);
    }

    return data.url;
  }

  async sendOtp(input: SignInWithOtpInput): Promise<{ sent: boolean }> {
    const client = input.client ?? (await createSupabaseServerClient());
    const sanitizedReturn = safeReturnTo(input.returnTo ?? '/');
    const baseUrl = input.siteUrl
      ? input.siteUrl.replace(/\/$/, '')
      : env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, '');
    const emailRedirectTo = `${baseUrl}/auth/callback?next=${encodeURIComponent(sanitizedReturn)}`;

    const { error } = await client.auth.signInWithOtp({
      email: input.email.trim(),
      options: {
        captchaToken: input.captchaToken,
        emailRedirectTo,
        shouldCreateUser: env.SIGNUPS_ENABLED,
      },
    });

    if (error) {
      log.warn({ error, email: input.email }, 'Supabase signInWithOtp rejected');
      // Anti-enumeration: still return { sent: true } unless severe configuration error
    }

    return { sent: true };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<{ user: AuthResultUser | null }> {
    const client = input.client ?? (await createSupabaseServerClient());

    const { data, error } = await client.auth.verifyOtp({
      email: input.email.trim(),
      token: input.token.trim(),
      type: input.type ?? 'email',
    });

    if (error || !data.user) {
      log.warn({ error, email: input.email }, 'Supabase verifyOtp failed');
      return { user: null };
    }

    return {
      user: {
        id: data.user.id,
        email: data.user.email ?? input.email,
        user_metadata: data.user.user_metadata,
      },
    };
  }

  async signOut(options?: { client?: SupabaseServerClient }): Promise<void> {
    try {
      const client = options?.client ?? (await createSupabaseServerClient());
      await client.auth.signOut({ scope: 'local' });
    } catch (err) {
      log.warn({ err }, 'error during Supabase signOut (ignored)');
    }
  }
}

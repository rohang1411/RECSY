import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import {
  createSupabaseServerClient,
  getVerifiedUserWithTimeout,
} from '@/services/auth/supabase-server';
import { ensureUserProfile } from '@/services/auth/profile';
import { claimAnonymousState } from '@/services/auth/claim-anonymous';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { safeReturnTo } from '@/services/auth/return-to';
import { getDb } from '@/services/db/client';
import { env } from '@/env';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'GET /auth/callback' });

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');
  const tokenHash = searchParams.get('token_hash');
  const type = (searchParams.get('type') || 'email') as EmailOtpType;
  const fakeUid = searchParams.get('fake_uid');
  const returnTo = safeReturnTo(searchParams.get('next'));
  const authError = searchParams.get('error');
  const authErrorCode = searchParams.get('error_code');
  const authErrorDesc = searchParams.get('error_description');

  const responseRedirect = NextResponse.redirect(new URL(returnTo, request.url), { status: 302 });

  try {
    const db = getDb();
    const identity = await resolveRequestIdentity(request, { db });
    const sessionToken = request.cookies.get('recsy_rec_session')?.value;

    if (env.AUTH_DRIVER === 'fake' && fakeUid) {
      await ensureUserProfile(db, {
        sub: fakeUid,
        email: 'test-user@localhost',
        user_metadata: { full_name: 'Test User' },
      });
      await claimAnonymousState(db, fakeUid, identity.deviceId, sessionToken);
      return responseRedirect;
    }

    const client = await createSupabaseServerClient();

    // Check if the user already has a valid session (e.g. concurrent or completed exchange)
    const existingUser = await getVerifiedUserWithTimeout(client).catch(() => null);
    if (existingUser) {
      log.info({ userId: existingUser.id }, 'auth callback: active session already present');
      await ensureUserProfile(db, {
        sub: existingUser.id,
        email: existingUser.email,
        user_metadata: existingUser.user_metadata,
      });
      await claimAnonymousState(db, existingUser.id, identity.deviceId, sessionToken);
      if (typeof client?.applyCookies === 'function') {
        client.applyCookies(responseRedirect);
      }
      return responseRedirect;
    }

    // Handle explicit errors returned by the auth provider
    if (authError || authErrorCode) {
      const errorKey = authErrorCode || authError;
      log.warn(
        { authError, authErrorCode, authErrorDesc },
        'auth callback received provider error',
      );
      const redirect = NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(errorKey ?? 'auth_error')}&error_description=${encodeURIComponent(authErrorDesc || '')}&next=${encodeURIComponent(returnTo)}`,
          request.url,
        ),
        { status: 302 },
      );
      if (typeof client?.applyCookies === 'function') {
        client.applyCookies(redirect);
      }
      return redirect;
    }

    if (code || tokenHash) {
      let user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null =
        null;

      if (code) {
        const { data, error } = await client.auth.exchangeCodeForSession(code);
        if (error || !data.user) {
          log.warn({ error }, 'Supabase PKCE code exchange failed');
          const fallbackUser = await getVerifiedUserWithTimeout(client).catch(() => null);
          if (fallbackUser) {
            user = fallbackUser;
          } else {
            const redirect = NextResponse.redirect(
              new URL(
                `/login?error=auth_exchange_failed&next=${encodeURIComponent(returnTo)}`,
                request.url,
              ),
              { status: 302 },
            );
            if (typeof client?.applyCookies === 'function') {
              client.applyCookies(redirect);
            }
            return redirect;
          }
        } else {
          user = data.user;
        }
      } else if (tokenHash) {
        const { data, error } = await client.auth.verifyOtp({
          token_hash: tokenHash,
          type,
        });
        if (error || !data.user) {
          log.warn({ error }, 'Supabase token hash verification failed');
          const redirect = NextResponse.redirect(
            new URL(
              `/login?error=auth_verify_failed&next=${encodeURIComponent(returnTo)}`,
              request.url,
            ),
            { status: 302 },
          );
          if (typeof client?.applyCookies === 'function') {
            client.applyCookies(redirect);
          }
          return redirect;
        }
        user = data.user;
      }

      if (user) {
        await ensureUserProfile(db, {
          sub: user.id,
          email: user.email,
          user_metadata: user.user_metadata,
        });

        await claimAnonymousState(db, user.id, identity.deviceId, sessionToken);
        if (typeof client?.applyCookies === 'function') {
          client.applyCookies(responseRedirect);
        }
        return responseRedirect;
      }
    }

    log.warn('auth callback missing code or credentials');
    return NextResponse.redirect(
      new URL(`/login?error=missing_code&next=${encodeURIComponent(returnTo)}`, request.url),
      { status: 302 },
    );
  } catch (err) {
    log.error({ err }, 'unexpected error in auth callback');
    return NextResponse.redirect(
      new URL(`/login?error=server_error&next=${encodeURIComponent(returnTo)}`, request.url),
      { status: 302 },
    );
  }
}

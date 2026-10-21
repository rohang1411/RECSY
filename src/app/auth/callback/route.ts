import { NextResponse, type NextRequest } from 'next/server';
import { createSupabaseServerClient } from '@/services/auth/supabase-server';
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
  const fakeUid = searchParams.get('fake_uid');
  const returnTo = safeReturnTo(searchParams.get('next'));

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

    if (code) {
      const client = await createSupabaseServerClient();
      const { data, error } = await client.auth.exchangeCodeForSession(code);

      if (error || !data.user) {
        log.warn({ error }, 'Supabase PKCE code exchange failed');
        return NextResponse.redirect(
          new URL(
            `/login?error=auth_exchange_failed&next=${encodeURIComponent(returnTo)}`,
            request.url,
          ),
          { status: 302 },
        );
      }

      await ensureUserProfile(db, {
        sub: data.user.id,
        email: data.user.email,
        user_metadata: data.user.user_metadata,
      });

      await claimAnonymousState(db, data.user.id, identity.deviceId, sessionToken);
      return responseRedirect;
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

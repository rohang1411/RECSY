import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/services/auth/supabase-server';
import { ensureUserProfile } from '@/services/auth/profile';
import { claimAnonymousState, extractSessionIdFromReturnTo } from '@/services/auth/claim-anonymous';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { normalizeEmail } from '@/services/auth/email';
import { getDb } from '@/services/db/client';
import { sql } from 'drizzle-orm';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'POST /auth/password/signin' });

const SignInSchema = z.object({
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
  sessionId: z.string().uuid().optional(),
  next: z.string().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const parsed = SignInSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'validation_failed', message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const { email, password } = parsed.data;
    const client = await createSupabaseServerClient();

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    const db = getDb();

    if (error || !data.user) {
      log.warn({ email, err: error?.message }, 'password sign-in rejected');

      // Check if user exists in user_profiles
      const normEmail = normalizeEmail(email);
      const existing = await db.execute(sql`
        SELECT id FROM user_profiles WHERE email_normalized = ${normEmail} LIMIT 1
      `);

      if (!existing[0]) {
        return NextResponse.json(
          {
            ok: false,
            error: 'user_not_found',
            message: 'No account found with this email. Please create one.',
          },
          { status: 404 },
        );
      }

      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_credentials',
          message: 'Incorrect password. Please verify and try again.',
        },
        { status: 401 },
      );
    }

    // Ensure profile & claim anonymous state
    // Plan 26 WP-02: Password signin keeps authoritative getUser() server round trip.
    const identity = await resolveRequestIdentity(request, { db });
    const sessionToken = request.cookies.get('recsy_rec_session')?.value;

    await ensureUserProfile(db, {
      sub: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
    });

    const presentedSessionId =
      parsed.data.sessionId || extractSessionIdFromReturnTo(parsed.data.next);
    const presentedSessionIds = presentedSessionId ? [presentedSessionId] : null;
    await claimAnonymousState(
      db,
      data.user.id,
      identity.deviceId,
      sessionToken,
      presentedSessionIds,
    );

    const response = NextResponse.json({
      ok: true,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
    if (typeof client?.applyCookies === 'function') {
      client.applyCookies(response);
    }
    return response;
  } catch (err) {
    log.error({ err }, 'unexpected error in password sign-in');
    return NextResponse.json(
      { ok: false, error: 'server_error', message: 'Failed to sign in. Please try again.' },
      { status: 500 },
    );
  }
}

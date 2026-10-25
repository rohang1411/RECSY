import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createSupabaseServerClient } from '@/services/auth/supabase-server';
import { ensureUserProfile } from '@/services/auth/profile';
import { claimAnonymousState } from '@/services/auth/claim-anonymous';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { normalizeEmail } from '@/services/auth/email';
import { getDb } from '@/services/db/client';
import { sql } from 'drizzle-orm';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'POST /auth/password/signup' });

const SignUpSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(100),
  email: z.string().trim().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => null);
    const parsed = SignUpSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'validation_failed', message: parsed.error.issues[0]?.message },
        { status: 400 },
      );
    }

    const { fullName, email, password, dateOfBirth } = parsed.data;
    const db = getDb();
    const normEmail = normalizeEmail(email);

    // Check if account already exists
    const existing = await db.execute(sql`
      SELECT id FROM user_profiles WHERE email_normalized = ${normEmail} LIMIT 1
    `);
    if (existing[0]) {
      return NextResponse.json(
        {
          ok: false,
          error: 'user_exists',
          message: 'An account with this email already exists. Please sign in.',
        },
        { status: 409 },
      );
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          date_of_birth: dateOfBirth || null,
        },
      },
    });

    if (error || !data.user) {
      log.warn({ email, err: error?.message }, 'password sign-up rejected by auth provider');
      return NextResponse.json(
        {
          ok: false,
          error: 'signup_failed',
          message: error?.message || 'Failed to create account. Please try again.',
        },
        { status: 400 },
      );
    }

    // Ensure profile in Postgres
    // Plan 26 WP-02: Password signup keeps authoritative getUser() server round trip.
    const identity = await resolveRequestIdentity(request, { db });
    const sessionToken = request.cookies.get('recsy_rec_session')?.value;

    await ensureUserProfile(db, {
      sub: data.user.id,
      email: data.user.email,
      user_metadata: {
        full_name: fullName,
        date_of_birth: dateOfBirth || null,
        ...data.user.user_metadata,
      },
    });

    await claimAnonymousState(db, data.user.id, identity.deviceId, sessionToken);

    const response = NextResponse.json({
      ok: true,
      requiresEmailConfirmation: !data.session,
      user: {
        id: data.user.id,
        email: data.user.email,
        displayName: fullName,
      },
    });
    if (typeof client?.applyCookies === 'function') {
      client.applyCookies(response);
    }
    return response;
  } catch (err) {
    log.error({ err }, 'unexpected error in password sign-up');
    return NextResponse.json(
      { ok: false, error: 'server_error', message: 'Failed to create account. Please try again.' },
      { status: 500 },
    );
  }
}

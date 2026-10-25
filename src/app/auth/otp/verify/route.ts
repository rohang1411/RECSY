import { NextResponse, type NextRequest } from 'next/server';
import { getAuthDriver } from '@/services/auth/driver';
import { ensureUserProfile } from '@/services/auth/profile';
import { claimAnonymousState } from '@/services/auth/claim-anonymous';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { readRequestJson } from '@/lib/request-json';
import { ValidationError } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { assertSameOrigin } from '@/lib/same-origin';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'POST /auth/otp/verify' });

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOrigin(request);
    const body = (await readRequestJson(request, 4096)) as Record<string, unknown>;
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : '';

    if (!rawEmail || !token) {
      throw new ValidationError('Email and 6-digit code are required');
    }

    const driver = getAuthDriver();
    const result = await driver.verifyOtp({
      email: rawEmail,
      token,
      type: 'email',
    });

    if (!result.user) {
      return NextResponse.json(
        { error: 'Invalid or expired verification code. Please check and try again.' },
        { status: 400 },
      );
    }

    const db = getDb();

    // 1. Ensure user profile exists / update last_seen_at
    await ensureUserProfile(db, {
      sub: result.user.id,
      email: result.user.email,
      user_metadata: result.user.user_metadata,
    });

    // 2. Anonymous-to-account graduation
    // Plan 26 WP-02: OTP verification keeps authoritative getUser() server round trip.
    const identity = await resolveRequestIdentity(request, { db });
    const sessionToken = request.cookies.get('recsy_rec_session')?.value;
    await claimAnonymousState(db, result.user.id, identity.deviceId, sessionToken);

    return NextResponse.json({
      ok: true,
      user: {
        id: result.user.id,
        email: result.user.email,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    log.error({ err }, 'unexpected error verifying OTP');
    return NextResponse.json(
      { error: 'Unable to verify code. Please try again.' },
      { status: 500 },
    );
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { getAuthDriver } from '@/services/auth/driver';
import { isDisposableEmail } from '@/services/auth/email';
import { safeReturnTo } from '@/services/auth/return-to';
import { readRequestJson } from '@/lib/request-json';
import { ValidationError } from '@/lib/errors';
import { getDb } from '@/services/db/client';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'POST /auth/otp/send' });

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await readRequestJson(request, 4096)) as Record<string, unknown>;
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';

    if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      throw new ValidationError('A valid email address is required');
    }

    const db = getDb();
    const isDisposable = await isDisposableEmail(rawEmail, { db });
    if (isDisposable) {
      return NextResponse.json(
        { error: 'Disposable and temporary email addresses are not accepted' },
        { status: 400 },
      );
    }

    const captchaToken =
      typeof body.captchaToken === 'string' ? body.captchaToken.trim() : undefined;
    const returnTo = safeReturnTo(typeof body.returnTo === 'string' ? body.returnTo : undefined);

    const driver = getAuthDriver();
    await driver.sendOtp({
      email: rawEmail,
      captchaToken,
      returnTo,
    });

    // Always respond with sent: true to protect user privacy (prevent email enumeration)
    return NextResponse.json({ sent: true });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    log.error({ err }, 'unexpected error sending OTP');
    return NextResponse.json(
      { error: 'Unable to send verification code. Please try again later.' },
      { status: 500 },
    );
  }
}

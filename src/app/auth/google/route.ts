import { NextResponse, type NextRequest } from 'next/server';
import { getAuthDriver } from '@/services/auth/driver';
import { safeReturnTo } from '@/services/auth/return-to';
import { resolveSiteUrl } from '@/lib/site-url';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: 'GET /auth/google' });

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const returnTo = safeReturnTo(searchParams.get('next'));
    const siteUrl = resolveSiteUrl(request);

    const driver = getAuthDriver();
    const redirectUrl = await driver.getGoogleOAuthUrl(returnTo, { siteUrl });

    return NextResponse.redirect(redirectUrl, { status: 302 });
  } catch (err) {
    log.error({ err }, 'failed to initiate Google OAuth');
    return NextResponse.redirect(new URL('/login?error=oauth_init_failed', request.url), {
      status: 302,
    });
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { getAuthDriver } from '@/services/auth/driver';
import { createSupabaseServerClient } from '@/services/auth/supabase-server';
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

    let client: Awaited<ReturnType<typeof createSupabaseServerClient>> | undefined;
    try {
      client = await createSupabaseServerClient();
    } catch {
      // In isolated mock environments where next/headers cookies() context is not present
    }

    const driver = getAuthDriver();
    const redirectUrl = await driver.getGoogleOAuthUrl(returnTo, { siteUrl, client });

    const response = NextResponse.redirect(redirectUrl, { status: 302 });
    if (client && typeof client.applyCookies === 'function') {
      client.applyCookies(response);
    }
    return response;
  } catch (err) {
    log.error({ err }, 'failed to initiate Google OAuth');
    return NextResponse.redirect(new URL('/login?error=oauth_init_failed', request.url), {
      status: 302,
    });
  }
}

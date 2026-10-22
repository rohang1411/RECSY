import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import { getRegionConfig, isSupportedRegion } from './lib/regions';
import {
  getDeviceCookieName,
  getDeviceCookieOptions,
  mintDeviceCookieValue,
} from './services/auth/device';
import { createSupabaseProxyClient } from './services/auth/supabase-server';

export const REGION_COOKIE = 'recsy_region';

/**
 * Proxy / Middleware (Next.js 16 Node.js runtime).
 *
 * Responsibilities, in order (cookie-only, zero DB calls):
 * 1. Region detection & cookie initialization.
 * 2. Supabase session token refresh (only when `sb-*` cookies exist).
 * 3. Device identity cookie (`__Host-recsy_did` / `recsy_did`) minting when missing.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const response = NextResponse.next();

  // 1. Region cookie logic (preserves existing behavior)
  const existingRegion = request.cookies.get(REGION_COOKIE)?.value;
  if (!existingRegion || !isSupportedRegion(existingRegion)) {
    const detected =
      request.headers.get('x-vercel-ip-country') ||
      request.headers.get('cf-ipcountry') ||
      request.headers.get('x-country-code') ||
      'US';

    const region = getRegionConfig(detected).countryCode;
    response.cookies.set({
      name: REGION_COOKIE,
      value: region,
      path: '/',
      maxAge: 31536000,
      sameSite: 'lax',
      secure: env.NODE_ENV === 'production',
      httpOnly: false, // Accessible by client JS for currency display
    });
  }

  // 2. Supabase auth token refresh (cookie-only)
  const hasSbCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.value.trim().length > 0);

  if (hasSbCookie && env.AUTH_DRIVER !== 'fake') {
    try {
      const supabase = createSupabaseProxyClient(request, response);
      await supabase.auth.getUser();
    } catch {
      // Ignored: expired or malformed cookies will be handled by route identity resolver
    }
  }

  // 3. Device cookie minting (16 bytes base64url)
  const deviceCookieName = getDeviceCookieName();
  const existingDeviceCookie = request.cookies.get(deviceCookieName)?.value;
  if (!existingDeviceCookie) {
    const newDid = mintDeviceCookieValue();
    response.cookies.set({
      name: deviceCookieName,
      value: newDid,
      ...getDeviceCookieOptions(),
    });
  }

  return response;
}

export const middleware = proxy;
export default proxy;

export const config = {
  matcher: [
    // Matches all pages and metered/account APIs.
    // Explicitly excludes static assets, health, webhooks, and internal endpoints.
    '/((?!_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image|robots.txt|sitemap.xml|manifest.webmanifest|api/billing/webhook|api/health|api/internal).*)',
  ],
};

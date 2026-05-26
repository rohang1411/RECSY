import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import { getRegionConfig, isSupportedRegion } from './lib/regions';

export const REGION_COOKIE = 'recsy_region';

export function middleware(request: NextRequest) {
  const existingCookie = request.cookies.get(REGION_COOKIE)?.value;

  // 1. Valid cookie already present — pass through, no-op.
  if (existingCookie && isSupportedRegion(existingCookie)) {
    return NextResponse.next();
  }

  // 2. Auto-detect from edge headers (zero latency — injected by Vercel/Cloudflare).
  const detected =
    request.headers.get('x-vercel-ip-country') || // Vercel production
    request.headers.get('cf-ipcountry') || // Cloudflare
    request.headers.get('x-country-code') || // Self-hosted nginx
    'US'; // Safe default

  // Validate: if unsupported country, fall back to default
  const region = getRegionConfig(detected).countryCode;

  const response = NextResponse.next();
  response.cookies.set({
    name: REGION_COOKIE,
    value: region,
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    httpOnly: false, // MUST be false so client JS can read it for display
  });

  return response;
}

export const config = {
  matcher: [
    // Match all routes EXCEPT static files, api routes, and Next internals
    '/((?!api|_next/static|_next/image|favicon.ico|apple-icon|icon|opengraph-image).*)',
  ],
};

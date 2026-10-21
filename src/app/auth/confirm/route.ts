import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/services/auth/supabase-server';
import { ensureUserProfile } from '@/services/auth/profile';
import { claimAnonymousState } from '@/services/auth/claim-anonymous';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { safeReturnTo } from '@/services/auth/return-to';
import { getDb } from '@/services/db/client';
import { logger } from '@/services/logger';

export const runtime = 'nodejs';

const log = logger.child({ route: '/auth/confirm' });

/**
 * Handles magic-link verification with protection against corporate email scanner prefetch.
 * GET serves a lightweight confirmation click screen so automated scanner GET requests
 * do NOT consume the single-use token.
 * POST executes the actual token exchange and session setup.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams;
  const tokenHash = searchParams.get('token_hash');
  const type = searchParams.get('type') || 'email';
  const returnTo = safeReturnTo(searchParams.get('next'));

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/login?error=invalid_magic_link', request.url), {
      status: 302,
    });
  }

  // Render a minimal, high-contrast, beautiful confirmation screen
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Confirm Sign-In — RECSY</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #09090b;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #18181b;
      border: 1px solid #27272a;
      padding: 2.5rem;
      max-width: 420px;
      width: 90%;
      text-align: center;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin: 0 0 0.75rem 0;
    }
    p {
      color: #a1a1aa;
      font-size: 0.875rem;
      line-height: 1.5;
      margin: 0 0 1.75rem 0;
    }
    button {
      background: #fafafa;
      color: #09090b;
      border: none;
      padding: 0.75rem 1.5rem;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: opacity 0.15s ease;
    }
    button:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>Confirm Sign-In</h1>
    <p>Click below to complete your sign-in to RECSY and access your personalized smartphone intelligence.</p>
    <form method="POST" action="/auth/confirm">
      <input type="hidden" name="token_hash" value="${encodeURIComponent(tokenHash)}" />
      <input type="hidden" name="type" value="${encodeURIComponent(type)}" />
      <input type="hidden" name="next" value="${encodeURIComponent(returnTo)}" />
      <button type="submit">Complete Sign-In</button>
    </form>
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const tokenHash = decodeURIComponent(String(formData.get('token_hash') || ''));
    const type = decodeURIComponent(String(formData.get('type') || 'email')) as EmailOtpType;
    const returnTo = safeReturnTo(decodeURIComponent(String(formData.get('next') || '/')));

    if (!tokenHash) {
      return NextResponse.redirect(new URL('/login?error=invalid_magic_link', request.url), {
        status: 302,
      });
    }

    const client = await createSupabaseServerClient();
    const { data, error } = await client.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (error || !data.user) {
      log.warn({ error }, 'magic link verifyOtp failed');
      return NextResponse.redirect(new URL('/login?error=expired_magic_link', request.url), {
        status: 302,
      });
    }

    const db = getDb();
    await ensureUserProfile(db, {
      sub: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
    });

    const identity = await resolveRequestIdentity(request, { db });
    const sessionToken = request.cookies.get('recsy_rec_session')?.value;
    await claimAnonymousState(db, data.user.id, identity.deviceId, sessionToken);

    return NextResponse.redirect(new URL(returnTo, request.url), { status: 302 });
  } catch (err) {
    log.error({ err }, 'unexpected error in POST /auth/confirm');
    return NextResponse.redirect(new URL('/login?error=server_error', request.url), {
      status: 302,
    });
  }
}

/**
 * POST /api/internal/auth — Operator Session Login
 * DELETE /api/internal/auth — Operator Session Logout
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import { createOperatorSession, OPERATOR_COOKIE_NAME } from '@/services/internal/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!env.INTERNAL_DASHBOARD_ENABLED) {
    return NextResponse.json({ error: 'Internal dashboard is disabled' }, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token.trim() : '';

    if (!token) {
      return NextResponse.json({ error: 'Operator token is required' }, { status: 400 });
    }

    const session = createOperatorSession(token);
    if (!session) {
      return NextResponse.json({ error: 'Invalid operator credentials' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: OPERATOR_COOKIE_NAME,
      value: session,
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return res;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Authentication failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: OPERATOR_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}

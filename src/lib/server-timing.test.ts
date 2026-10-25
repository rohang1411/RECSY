import { describe, expect, it, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { env } from '@/env';
import { shouldEmitServerTiming } from './server-timing';
import * as internalAuth from '@/services/internal/auth';

describe('shouldEmitServerTiming', () => {
  const originalNodeEnv = env.NODE_ENV;

  afterEach(() => {
    (env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv;
    vi.restoreAllMocks();
  });

  it('allows Server-Timing in non-production environments', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'development';
    const req = new NextRequest('http://localhost/api/ask');
    expect(shouldEmitServerTiming(req)).toBe(true);
  });

  it('blocks Server-Timing in production without operator session or token', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    const req = new NextRequest('https://recsy.app/api/ask');
    expect(shouldEmitServerTiming(req)).toBe(false);
  });

  it('allows Server-Timing in production with valid operator cookie', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    vi.spyOn(internalAuth, 'verifyOperatorSessionToken').mockReturnValue(true);

    const req = new NextRequest('https://recsy.app/api/ask', {
      headers: {
        cookie: `${internalAuth.OPERATOR_COOKIE_NAME}=valid.session.token`,
      },
    });
    expect(shouldEmitServerTiming(req)).toBe(true);
  });

  it('allows Server-Timing in production with valid x-operator-token header', () => {
    (env as { NODE_ENV: string }).NODE_ENV = 'production';
    vi.spyOn(internalAuth, 'verifyOperatorToken').mockReturnValue(true);

    const req = new NextRequest('https://recsy.app/api/ask', {
      headers: {
        'x-operator-token': 'secret-token',
      },
    });
    expect(shouldEmitServerTiming(req)).toBe(true);
  });
});

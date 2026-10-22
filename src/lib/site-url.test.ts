import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { resolveSiteUrl } from './site-url';

describe('resolveSiteUrl', () => {
  it('resolves origin from NextRequest nextUrl', () => {
    const req = new NextRequest('https://recsy-pi.vercel.app/auth/google');
    expect(resolveSiteUrl(req)).toBe('https://recsy-pi.vercel.app');
  });

  it('resolves origin from x-forwarded-host and x-forwarded-proto headers', () => {
    const req = new NextRequest('http://internal-node-listener/auth/google', {
      headers: {
        'x-forwarded-host': 'recsy.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(resolveSiteUrl(req)).toBe('https://recsy.com');
  });

  it('strips trailing slashes from origin', () => {
    const req = new NextRequest('https://recsy-staging.vercel.app/');
    expect(resolveSiteUrl(req)).toBe('https://recsy-staging.vercel.app');
  });

  it('falls back to environment when request is null', () => {
    const url = resolveSiteUrl(null);
    expect(url).toMatch(/^https?:\/\//);
  });
});

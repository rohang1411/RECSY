import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isTrustedSiteHost, resolveSiteUrl } from './site-url';

describe('isTrustedSiteHost', () => {
  it('identifies localhost and 127.0.0.1 as trusted', () => {
    expect(isTrustedSiteHost('localhost')).toBe(true);
    expect(isTrustedSiteHost('localhost:3000')).toBe(true);
    expect(isTrustedSiteHost('127.0.0.1')).toBe(true);
    expect(isTrustedSiteHost('127.0.0.1:3000')).toBe(true);
  });

  it('identifies recsy domains and vercel preview domains as trusted', () => {
    expect(isTrustedSiteHost('recsy.com')).toBe(true);
    expect(isTrustedSiteHost('staging.recsy.com')).toBe(true);
    expect(isTrustedSiteHost('recsy.app')).toBe(true);
    expect(isTrustedSiteHost('recsy-pi.vercel.app')).toBe(true);
  });

  it('rejects untrusted third-party hosts', () => {
    expect(isTrustedSiteHost('evil-attacker.com')).toBe(false);
    expect(isTrustedSiteHost('attacker.recsy.com.evil.com')).toBe(false);
    expect(isTrustedSiteHost('phishing.org')).toBe(false);
    expect(isTrustedSiteHost('')).toBe(false);
    expect(isTrustedSiteHost(null)).toBe(false);
  });
});

describe('resolveSiteUrl', () => {
  it('resolves origin from NextRequest nextUrl', () => {
    const req = new NextRequest('https://recsy-pi.vercel.app/auth/google');
    expect(resolveSiteUrl(req)).toBe('https://recsy-pi.vercel.app');
  });

  it('resolves origin from trusted x-forwarded-host and x-forwarded-proto headers', () => {
    const req = new NextRequest('http://internal-node-listener/auth/google', {
      headers: {
        'x-forwarded-host': 'recsy.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(resolveSiteUrl(req)).toBe('https://recsy.com');
  });

  it('ignores untrusted x-forwarded-host and falls back to configured site url', () => {
    const req = new NextRequest('http://internal-node-listener/auth/google', {
      headers: {
        'x-forwarded-host': 'evil-phishing.com',
        'x-forwarded-proto': 'https',
      },
    });
    expect(resolveSiteUrl(req)).not.toContain('evil-phishing.com');
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

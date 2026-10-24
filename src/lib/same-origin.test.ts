import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { assertSameOrigin } from './same-origin';
import { AppError } from './errors';

describe('assertSameOrigin', () => {
  it('passes when Origin matches host exactly', () => {
    const req = new NextRequest('https://recsy.app/api/recommend', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        origin: 'https://recsy.app',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('passes when Origin matches x-forwarded-host', () => {
    const req = new NextRequest('https://recsy.app/api/ask', {
      method: 'POST',
      headers: {
        host: 'internal-cluster:8080',
        'x-forwarded-host': 'recsy.app',
        origin: 'https://recsy.app',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects cross-origin requests when Origin and x-forwarded-host match an untrusted domain', () => {
    const req = new NextRequest('https://recsy.app/api/billing/checkout', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        'x-forwarded-host': 'evil-phishing.com',
        origin: 'https://evil-phishing.com',
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
    try {
      assertSameOrigin(req);
    } catch (err) {
      expect((err as AppError).code).toBe('BAD_ORIGIN');
      expect((err as AppError).status).toBe(403);
    }
  });

  it('passes for localhost development origins', () => {
    const req = new NextRequest('http://localhost:3000/api/recommend', {
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('passes for 127.0.0.1 development origins', () => {
    const req = new NextRequest('http://127.0.0.1:3000/api/recommend', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3000',
        origin: 'http://127.0.0.1:3000',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects cross-origin requests with mismatched Origin header', () => {
    const req = new NextRequest('https://recsy.app/api/billing/checkout', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        origin: 'https://evil-phishing.com',
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
    try {
      assertSameOrigin(req);
    } catch (err) {
      expect((err as AppError).code).toBe('BAD_ORIGIN');
      expect((err as AppError).status).toBe(403);
    }
  });

  it('passes when Origin is absent but Sec-Fetch-Site is same-origin', () => {
    const req = new NextRequest('https://recsy.app/api/account/export', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        'sec-fetch-site': 'same-origin',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('passes when Origin is absent but Sec-Fetch-Site is none', () => {
    const req = new NextRequest('https://recsy.app/api/account/export', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        'sec-fetch-site': 'none',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects cross-site Sec-Fetch-Site when Origin is absent', () => {
    const req = new NextRequest('https://recsy.app/api/account/delete', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        'sec-fetch-site': 'cross-site',
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
  });

  it('passes non-browser requests without ambient credentials', () => {
    const req = new NextRequest('https://recsy.app/api/recommend', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
      },
    });

    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it('rejects requests with ambient auth credentials lacking Origin and Sec-Fetch-Site', () => {
    const req = new NextRequest('https://recsy.app/api/account/delete', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        cookie: 'sb-recsy-auth-token=secret-token-xyz; other=1',
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
    try {
      assertSameOrigin(req);
    } catch (err) {
      expect((err as AppError).code).toBe('BAD_ORIGIN');
      expect((err as AppError).status).toBe(403);
    }
  });

  it('rejects malformed Origin URLs', () => {
    const req = new NextRequest('https://recsy.app/api/recommend', {
      method: 'POST',
      headers: {
        host: 'recsy.app',
        origin: 'not-a-valid-url',
      },
    });

    expect(() => assertSameOrigin(req)).toThrowError(AppError);
  });
});

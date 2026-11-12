import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST, GET } from './route';
import { logger } from '@/services/logger';
import * as rateLimitService from '@/services/rate-limit';
import { RateLimitError } from '@/lib/errors';

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects GET requests with 405 Method Not Allowed', async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('POST');
  });

  it('rejects payloads exceeding 8 KB via Content-Length header', async () => {
    const req = new NextRequest('https://recsy.app/api/csp-report', {
      method: 'POST',
      headers: {
        'content-length': '9000',
      },
      body: 'large-payload',
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('rejects body content exceeding 8 KB', async () => {
    const oversizedBody = 'x'.repeat(9000);
    const req = new NextRequest('https://recsy.app/api/csp-report', {
      method: 'POST',
      body: oversizedBody,
    });

    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('processes legacy csp-report payloads and sanitizes URLs', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    vi.spyOn(rateLimitService, 'consumeCspReportRateLimit').mockResolvedValue(undefined);

    const payload = {
      'csp-report': {
        'document-uri': 'https://recsy.app/recommend?user=123#tab',
        'blocked-uri': 'https://evil.com/tracker.js?key=secret-token',
        'effective-directive': 'script-src',
        disposition: 'report',
      },
    };

    const req = new NextRequest('https://recsy.app/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/csp-report',
      },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(204);

    expect(warnSpy).toHaveBeenCalledWith(
      {
        cspReport: {
          directive: 'script-src',
          blockedUri: 'https://evil.com/tracker.js', // Query string stripped!
          documentUri: 'https://recsy.app/recommend', // Query string and hash stripped!
          disposition: 'report',
        },
      },
      'CSP violation report received',
    );
  });

  it('processes modern Reporting API format', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    vi.spyOn(rateLimitService, 'consumeCspReportRateLimit').mockResolvedValue(undefined);

    const payload = [
      {
        type: 'csp-violation',
        url: 'https://recsy.app/p/pixel-9-pro',
        body: {
          documentURL: 'https://recsy.app/p/pixel-9-pro',
          blockedURL: 'https://unauthorized-cdn.com/font.woff2',
          effectiveDirective: 'font-src',
          disposition: 'report',
        },
      },
    ];

    const req = new NextRequest('https://recsy.app/api/csp-report', {
      method: 'POST',
      headers: {
        'content-type': 'application/reports+json',
      },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(204);

    expect(warnSpy).toHaveBeenCalledWith(
      {
        cspReport: {
          directive: 'font-src',
          blockedUri: 'https://unauthorized-cdn.com/font.woff2',
          documentUri: 'https://recsy.app/p/pixel-9-pro',
          disposition: 'report',
        },
      },
      'CSP violation report received',
    );
  });

  it('returns 429 when rate limit is exceeded', async () => {
    vi.spyOn(rateLimitService, 'consumeCspReportRateLimit').mockRejectedValue(
      new RateLimitError({ retryAfter: 60 }),
    );

    const req = new NextRequest('https://recsy.app/api/csp-report', {
      method: 'POST',
      body: JSON.stringify({ 'csp-report': {} }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('handles empty or malformed JSON gracefully', async () => {
    vi.spyOn(rateLimitService, 'consumeCspReportRateLimit').mockResolvedValue(undefined);

    const req = new NextRequest('https://recsy.app/api/csp-report', {
      method: 'POST',
      body: 'this is not valid json',
    });

    const res = await POST(req);
    expect(res.status).toBe(204);
  });
});

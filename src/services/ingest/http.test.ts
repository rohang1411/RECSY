import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '@/lib/errors';

import { makePoliteHttp, parseRobotsDisallow } from './http';
import { normalizeHost } from './rate-limit';

function makeResponse(
  body: string,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

describe('parseRobotsDisallow', () => {
  it('returns [] on empty input', () => {
    expect(parseRobotsDisallow('')).toEqual([]);
  });

  it('parses the global group', () => {
    const txt = `
User-agent: *
Disallow: /private/
Disallow: /admin

User-agent: Googlebot
Disallow: /nope
    `;
    const result = parseRobotsDisallow(txt);
    expect(result).toEqual(expect.arrayContaining(['/private/', '/admin']));
    expect(result).not.toContain('/nope');
  });

  it('respects a RECSYBot-specific group', () => {
    const txt = `
User-agent: RECSYBot
Disallow: /beta/
    `;
    expect(parseRobotsDisallow(txt)).toEqual(['/beta/']);
  });

  it('treats empty Disallow as permissive', () => {
    const txt = `
User-agent: *
Disallow:
    `;
    expect(parseRobotsDisallow(txt)).toEqual([]);
  });
});

describe('normalizeHost', () => {
  it('strips scheme, www, path and port', () => {
    expect(normalizeHost('https://www.gsmarena.com/foo/bar')).toBe('gsmarena.com');
    expect(normalizeHost('REDDIT.COM:443')).toBe('reddit.com');
  });
});

describe('PoliteHttp', () => {
  it('GETs a URL after consulting a permissive robots.txt', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/robots.txt')) return makeResponse('');
      return makeResponse('<html>body</html>');
    }) as unknown as typeof fetch;

    const http = makePoliteHttp({
      fetchImpl,
      // Zero delay keeps the test fast.
      rateLimitOptions: { defaultMs: 0, jitter: 0 },
      random: () => 0,
    });
    const res = await http.get('https://example.com/article');
    expect(res.status).toBe(200);
    expect(res.body).toContain('body');
  });

  it('throws NotFoundError when robots.txt disallows the path', async () => {
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/robots.txt')) {
        return makeResponse('User-agent: *\nDisallow: /private');
      }
      return makeResponse('should never be fetched');
    }) as unknown as typeof fetch;

    const http = makePoliteHttp({
      fetchImpl,
      rateLimitOptions: { defaultMs: 0, jitter: 0 },
      random: () => 0,
    });
    await expect(http.get('https://example.com/private/page')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    // Only robots.txt should have been hit.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rotates User-Agent across calls from the pool', async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init: RequestInit | undefined) => {
      const u = typeof url === 'string' ? url : url.toString();
      const h = (init?.headers ?? {}) as Record<string, string>;
      if (h['User-Agent']) seen.push(h['User-Agent']);
      if (u.endsWith('/robots.txt')) return makeResponse('');
      return makeResponse('ok');
    }) as unknown as typeof fetch;

    let n = 0;
    const http = makePoliteHttp({
      fetchImpl,
      rateLimitOptions: { defaultMs: 0, jitter: 0 },
      // Deterministic rotation: 0, 0.5, 0.9 → indices 0, 1, 2.
      random: () => [0, 0.5, 0.9][n++ % 3]!,
      userAgents: ['UA-A', 'UA-B', 'UA-C'],
    });
    await http.get('https://example.com/a');
    await http.get('https://example.com/b');
    await http.get('https://example.com/c');
    // robots.txt is cached after first call, so we should see 4 UAs across
    // 4 fetches (1 robots + 3 pages).
    expect(seen.length).toBeGreaterThanOrEqual(4);
    // At least two different UAs were used across the three page fetches.
    const pageUas = seen.filter((ua) => ua.startsWith('UA-'));
    const unique = new Set(pageUas);
    expect(unique.size).toBeGreaterThanOrEqual(2);
  });

  it('maps 404 to NotFoundError without retrying', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/robots.txt')) return makeResponse('');
      calls += 1;
      return makeResponse('missing', { status: 404 });
    }) as unknown as typeof fetch;

    const http = makePoliteHttp({
      fetchImpl,
      rateLimitOptions: { defaultMs: 0, jitter: 0 },
      random: () => 0,
    });
    await expect(http.get('https://example.com/gone', { retries: 5 })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(calls).toBe(1);
  });

  it('retries 503 and eventually succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/robots.txt')) return makeResponse('');
      n += 1;
      if (n === 1) return makeResponse('retry', { status: 503, headers: { 'Retry-After': '0' } });
      return makeResponse('ok');
    }) as unknown as typeof fetch;

    const http = makePoliteHttp({
      fetchImpl,
      rateLimitOptions: { defaultMs: 0, jitter: 0 },
      random: () => 0,
    });
    const res = await http.get('https://example.com/flaky', { retries: 2 });
    expect(res.status).toBe(200);
    expect(n).toBe(2);
  });
});

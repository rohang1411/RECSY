import { describe, expect, it, vi, beforeEach } from 'vitest';
import { revalidateTag } from 'next/cache';
import { POST } from './route';
import { computeHmacSha256 } from '@/lib/hmac';
import * as envModule from '@/env';
import * as dbModule from '@/services/db/client';
import type { NextRequest } from 'next/server';

vi.mock('next/cache', () => ({
  revalidateTag: vi.fn(),
}));

function createMockRequest(options: {
  headers?: Record<string, string>;
  body?: string;
}): NextRequest {
  const headersMap = new Map<string, string>();
  for (const [k, v] of Object.entries(options.headers || {})) {
    headersMap.set(k.toLowerCase(), v);
  }

  return {
    headers: {
      get: (k: string) => headersMap.get(k.toLowerCase()) ?? null,
    },
    text: async () => options.body ?? '',
  } as unknown as NextRequest;
}

describe('POST /api/internal/revalidate', () => {
  const secret = 'valid-test-revalidate-secret-32-chars-length!';

  beforeEach(() => {
    vi.clearAllMocks();
    (envModule.env as { REVALIDATE_SECRET?: string }).REVALIDATE_SECRET = secret;
    vi.spyOn(dbModule, 'getDb').mockReturnValue({
      execute: vi.fn().mockResolvedValue([{ count: 1 }]),
    } as never);
  });

  it('revalidates valid tags with max profile when authenticated', async () => {
    const timestamp = String(Date.now());
    const body = JSON.stringify({
      tags: ['phones', 'browse', 'phone:iphone-16'],
      reason: 'catalog update',
    });
    const signature = computeHmacSha256(`${timestamp}.${body}`, secret);

    const req = createMockRequest({
      headers: {
        'x-recsy-timestamp': timestamp,
        'x-recsy-signature': signature,
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.revalidated).toEqual(['phones', 'browse', 'phone:iphone-16']);
    expect(revalidateTag).toHaveBeenCalledWith('phones', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('browse', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('phone:iphone-16', 'max');
  });

  it('returns 401 when signature is invalid', async () => {
    const timestamp = String(Date.now());
    const body = JSON.stringify({
      tags: ['phones'],
      reason: 'test',
    });

    const req = createMockRequest({
      headers: {
        'x-recsy-timestamp': timestamp,
        'x-recsy-signature': '0'.repeat(64),
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns 401 when timestamp is older than 5 minutes', async () => {
    const timestamp = String(Date.now() - 6 * 60 * 1000);
    const body = JSON.stringify({
      tags: ['phones'],
      reason: 'test',
    });
    const signature = computeHmacSha256(`${timestamp}.${body}`, secret);

    const req = createMockRequest({
      headers: {
        'x-recsy-timestamp': timestamp,
        'x-recsy-signature': signature,
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns 400 when tag pattern is invalid', async () => {
    const timestamp = String(Date.now());
    const body = JSON.stringify({
      tags: ['disallowed-tag-format'],
      reason: 'test',
    });
    const signature = computeHmacSha256(`${timestamp}.${body}`, secret);

    const req = createMockRequest({
      headers: {
        'x-recsy-timestamp': timestamp,
        'x-recsy-signature': signature,
      },
      body,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid tag format');
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('returns 500 when REVALIDATE_SECRET is unset', async () => {
    (envModule.env as { REVALIDATE_SECRET?: string }).REVALIDATE_SECRET = undefined;

    const req = createMockRequest({
      headers: {
        'x-recsy-timestamp': String(Date.now()),
        'x-recsy-signature': 'sig',
      },
      body: '{}',
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

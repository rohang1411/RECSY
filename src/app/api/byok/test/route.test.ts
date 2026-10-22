import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import * as rateLimitModule from '@/services/rate-limit';
import { GeminiProvider } from '@/services/llm/gemini';
import { OpenAiCompatibleAdapter } from '@/services/llm/adapters/openai-compatible';
import { RateLimitError } from '@/lib/errors';

describe('POST /api/byok/test', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 429 when rate limit is exceeded', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockRejectedValueOnce(
      new RateLimitError({
        reset: Math.floor(Date.now() / 1000) + 3600,
        status: 429,
      }),
    );

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'test-key-12345678',
        provider: 'gemini',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('RATE_LIMITED');
    expect(res.headers.get('Retry-After')).toBe('3600');
  });

  it('returns 400 when apiKey is missing or shorter than 8 chars', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'short',
        provider: 'gemini',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('VALIDATION');
  });

  it('returns 400 when provider is unsupported', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'valid-api-key-12345678',
        provider: 'unsupported-provider',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BYOK_UNSUPPORTED');
  });

  it('returns 200 on successful gemini probe', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);
    const mockChat = vi.fn().mockResolvedValue({ text: 'pong' });
    vi.spyOn(GeminiProvider, 'withKey').mockReturnValue({
      chat: mockChat,
    } as unknown as GeminiProvider);

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'AIzaSy-user-valid-key-12345678',
        provider: 'gemini',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('gemini');
    expect(mockChat).toHaveBeenCalled();
  });

  it('returns 200 on successful groq probe with OpenAI-compatible adapter', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);
    const mockChat = vi.fn().mockResolvedValue({ text: 'pong' });
    vi.spyOn(OpenAiCompatibleAdapter.prototype, 'chat').mockImplementation(mockChat);

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'gsk-user-valid-groq-key-12345678',
        provider: 'groq',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('groq');
    expect(mockChat).toHaveBeenCalled();
  });

  it('reads from headers if request body is empty', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);
    const mockChat = vi.fn().mockResolvedValue({ text: 'pong' });
    vi.spyOn(GeminiProvider, 'withKey').mockReturnValue({
      chat: mockChat,
    } as unknown as GeminiProvider);

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      headers: {
        'x-recsy-user-key': 'AIzaSy-from-header-12345678',
        'x-recsy-user-provider': 'gemini',
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.provider).toBe('gemini');
  });

  it('maps probe 401/403 failure to 400 BYOK_REJECTED', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);
    vi.spyOn(OpenAiCompatibleAdapter.prototype, 'chat').mockRejectedValueOnce({
      status: 401,
      message: 'Invalid API Key',
    });

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'gsk-invalid-groq-key-12345678',
        provider: 'groq',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('BYOK_REJECTED');
  });

  it('maps probe 429 failure to 429 BYOK_RATE_LIMITED', async () => {
    vi.spyOn(rateLimitModule, 'consumeByokTestRateLimit').mockResolvedValueOnce(undefined);
    vi.spyOn(OpenAiCompatibleAdapter.prototype, 'chat').mockRejectedValueOnce({
      status: 429,
      message: 'Rate limit exceeded',
    });

    const req = new NextRequest('http://localhost/api/byok/test', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'gsk-busy-groq-key-12345678',
        provider: 'groq',
      }),
      headers: { 'content-type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe('BYOK_RATE_LIMITED');
  });
});

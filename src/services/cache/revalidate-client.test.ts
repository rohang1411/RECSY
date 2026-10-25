/* eslint-disable no-restricted-syntax -- testing process.env in revalidation client. */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { revalidatePublicTags } from '../../../scripts/lib/revalidate-client';
import { verifyHmacSha256 } from '@/lib/hmac';

describe('revalidatePublicTags client', () => {
  const origUrl = process.env.REVALIDATE_URL;
  const origSecret = process.env.REVALIDATE_SECRET;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env.REVALIDATE_URL = origUrl;
    process.env.REVALIDATE_SECRET = origSecret;
  });

  it('no-ops when REVALIDATE_URL or REVALIDATE_SECRET is unset', async () => {
    delete process.env.REVALIDATE_URL;
    delete process.env.REVALIDATE_SECRET;

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(revalidatePublicTags(['phones'], 'test')).resolves.not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('signs payload and calls endpoint successfully', async () => {
    const secret = 'test-secret-at-least-32-characters-long!';
    process.env.REVALIDATE_URL = 'http://localhost:3000/api/internal/revalidate';
    process.env.REVALIDATE_SECRET = secret;

    let sentTimestamp = '';
    let sentSignature = '';
    let sentBody = '';

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      sentTimestamp = headers['x-recsy-timestamp'] ?? '';
      sentSignature = headers['x-recsy-signature'] ?? '';
      sentBody = String(init?.body);

      return new Response(JSON.stringify({ revalidated: ['phones'] }), { status: 200 });
    });

    await revalidatePublicTags(['phones'], 'auto-refresh');
    expect(fetchSpy).toHaveBeenCalled();
    expect(verifyHmacSha256(`${sentTimestamp}.${sentBody}`, sentSignature, secret)).toBe(true);
  });

  it('never throws even when network errors out on all attempts', async () => {
    process.env.REVALIDATE_URL = 'http://localhost:3000/api/internal/revalidate';
    process.env.REVALIDATE_SECRET = 'test-secret-at-least-32-characters-long!';

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network offline'));

    await expect(revalidatePublicTags(['phones'], 'test-failure')).resolves.not.toThrow();
  });
});

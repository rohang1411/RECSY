import { describe, expect, it, vi } from 'vitest';

import type { PhoneRef } from '../types';
import { RedditAdapter, type SubredditProfile } from './reddit';

const phone: PhoneRef = {
  id: 'p1',
  slug: 'samsung-galaxy-s25-ultra',
  brand: 'Samsung',
  model: 'Galaxy S25 Ultra',
  launchDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
};

type FetchArgs = Parameters<typeof fetch>;

function makeFetchStub(
  handlers: Record<string, unknown>,
): (...args: FetchArgs) => Promise<Response> {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const hit = Object.entries(handlers).find(([key]) => url.includes(key));
    if (!hit) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(hit[1]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

function listing(
  posts: Array<{
    id: string;
    title: string;
    selftext?: string;
    score: number;
    permalink?: string;
    stickied?: boolean;
  }>,
): unknown {
  return {
    data: {
      children: posts.map((p) => ({
        data: {
          id: p.id,
          title: p.title,
          selftext: p.selftext ?? 'some body text',
          score: p.score,
          permalink: p.permalink ?? `/r/X/comments/${p.id}/`,
          stickied: p.stickied ?? false,
          over_18: false,
          author: 'u/someone',
          num_comments: 10,
          created_utc: 1_700_000_000,
        },
      })),
    },
  };
}

describe('RedditAdapter.discover — /search path', () => {
  it('returns posts from configured subreddits', async () => {
    const subredditProfiles: SubredditProfile[] = [
      { name: 'GalaxyS25', scope: 'device', minScore: 10 },
    ];
    const fetchImpl = makeFetchStub({
      '/r/GalaxyS25/search.json': listing([{ id: 'a', title: 'S25 Ultra impressions', score: 50 }]),
      '/r/GalaxyS25/new.json': listing([]),
    });
    const adapter = new RedditAdapter({
      subredditProfiles,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await adapter.discover(phone, { limit: 5 });
    expect(got.length).toBeGreaterThanOrEqual(1);
    expect(got[0]!.channel).toBe('r/GalaxyS25');
  });

  it('skips posts below minScore', async () => {
    const subredditProfiles: SubredditProfile[] = [
      { name: 'GalaxyS25', scope: 'device', minScore: 50 },
    ];
    const fetchImpl = makeFetchStub({
      '/r/GalaxyS25/search.json': listing([
        { id: 'lo', title: 'low score post', score: 5 },
        { id: 'hi', title: 'high score post', score: 100 },
      ]),
      '/r/GalaxyS25/new.json': listing([]),
    });
    const adapter = new RedditAdapter({
      subredditProfiles,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await adapter.discover(phone, { limit: 5 });
    const ids = got.map((c) => (c.raw as { postId: string }).postId);
    expect(ids).toContain('hi');
    expect(ids).not.toContain('lo');
  });
});

describe('RedditAdapter.discover — /new path', () => {
  it('device-scope subs are polled for /new by default', async () => {
    const subredditProfiles: SubredditProfile[] = [
      { name: 'GooglePixel', scope: 'device', minScore: 10 },
    ];
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes('/search.json')) {
        return new Response(JSON.stringify(listing([])), { status: 200 });
      }
      if (url.includes('/new.json')) {
        return new Response(
          JSON.stringify(listing([{ id: 'newfresh', title: 'Brand new Pixel post', score: 20 }])),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    const adapter = new RedditAdapter({
      subredditProfiles,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await adapter.discover(phone, { limit: 5 });
    expect(calls.some((u) => u.includes('/new.json'))).toBe(true);
    expect(got.some((c) => (c.raw as { discoveredVia: string }).discoveredVia === 'new')).toBe(
      true,
    );
  });

  it('general-scope subs only include /new posts whose title/body mentions the phone', async () => {
    const subredditProfiles: SubredditProfile[] = [
      { name: 'Android', scope: 'general', minScore: 10 },
    ];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/search.json')) {
        return new Response(JSON.stringify(listing([])), { status: 200 });
      }
      if (url.includes('/new.json')) {
        return new Response(
          JSON.stringify(
            listing([
              { id: 'match', title: 'I tried the Samsung Galaxy S25 Ultra', score: 20 },
              { id: 'nope', title: 'Random unrelated tip', score: 20 },
            ]),
          ),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    });
    const adapter = new RedditAdapter({
      subredditProfiles,
      pollNew: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await adapter.discover(phone, { limit: 5 });
    const ids = got.map((c) => (c.raw as { postId: string }).postId);
    expect(ids).toContain('match');
    expect(ids).not.toContain('nope');
  });

  it('general-scope subs with pollNew=false skip the /new.json call', async () => {
    const subredditProfiles: SubredditProfile[] = [
      { name: 'Android', scope: 'general', minScore: 10 },
    ];
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (url.includes('/search.json')) {
        return new Response(JSON.stringify(listing([])), { status: 200 });
      }
      return new Response('', { status: 404 });
    });
    const adapter = new RedditAdapter({
      subredditProfiles,
      pollNew: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await adapter.discover(phone, { limit: 5 });
    expect(calls.some((u) => u.includes('/new.json'))).toBe(false);
  });
});

describe('RedditAdapter OAuth', () => {
  it('uses oauth.reddit.com when app credentials are configured', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      calls.push(url);
      if (url === 'https://www.reddit.com/api/v1/access_token') {
        expect(init?.method).toBe('POST');
        return new Response(
          JSON.stringify({
            access_token: 'token-123',
            token_type: 'bearer',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('https://oauth.reddit.com/r/GalaxyS25/search')) {
        return new Response(
          JSON.stringify(listing([{ id: 'a', title: 'S25 Ultra review', score: 50 }])),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
      }
      if (url.includes('https://oauth.reddit.com/r/GalaxyS25/new')) {
        return new Response(JSON.stringify(listing([])), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    });
    const adapter = new RedditAdapter({
      subredditProfiles: [{ name: 'GalaxyS25', scope: 'device', minScore: 10 }],
      oauth: { clientId: 'cid', clientSecret: 'secret' },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const got = await adapter.discover(phone, { limit: 5 });
    expect(got).toHaveLength(1);
    expect(calls[0]).toBe('https://www.reddit.com/api/v1/access_token');
    expect(calls.some((u) => u.startsWith('https://oauth.reddit.com/r/GalaxyS25/search'))).toBe(
      true,
    );
  });
});

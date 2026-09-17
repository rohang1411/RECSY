import { describe, expect, it } from 'vitest';

import type { AliasRow } from '../agents/alias-match';
import type { PoliteHttp } from '../http';
import type { PhoneRef } from '../types';
import {
  YouTubeChannelAdapter,
  extractCandidatePhonesFromTitle,
  parseYouTubeRss,
  type RssEntry,
} from './youtube-channel';
import { YouTubeAdapter } from './youtube';

const s25Ultra: PhoneRef = {
  id: 'p-s25u',
  slug: 'samsung-galaxy-s25-ultra',
  brand: 'Samsung',
  model: 'Galaxy S25 Ultra',
  launchDate: '2025-02-22',
};

const ALIASES: readonly AliasRow[] = [
  { phoneId: 'p-s25u', slug: 'samsung-galaxy-s25-ultra', alias: 'Galaxy S25 Ultra', priority: 100 },
  { phoneId: 'p-s25u', slug: 'samsung-galaxy-s25-ultra', alias: 'S25 Ultra', priority: 90 },
  { phoneId: 'p-p9pxl', slug: 'google-pixel-9-pro-xl', alias: 'Pixel 9 Pro XL', priority: 100 },
];

const MKBHD_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:ABC123</id>
    <yt:videoId>ABC123</yt:videoId>
    <yt:channelId>UCBJycsmduvYEL83R_U4JriQ</yt:channelId>
    <title>Galaxy S25 Ultra — the one to beat?</title>
    <author><name>Marques Brownlee</name></author>
    <published>2025-03-01T14:00:00+00:00</published>
    <media:group><media:description>Full review of the Galaxy S25 Ultra.</media:description></media:group>
  </entry>
  <entry>
    <id>yt:video:DEF456</id>
    <yt:videoId>DEF456</yt:videoId>
    <title>My camera setup 2025</title>
    <author><name>Marques Brownlee</name></author>
    <published>2025-03-05T14:00:00+00:00</published>
    <media:group><media:description>Behind the scenes camera talk.</media:description></media:group>
  </entry>
  <entry>
    <id>yt:video:GHI789</id>
    <yt:videoId>GHI789</yt:videoId>
    <title>S25 Ultra vs Pixel 9 Pro XL — the ultimate camera shootout</title>
    <author><name>Marques Brownlee</name></author>
    <published>2025-03-10T14:00:00+00:00</published>
    <media:group><media:description>Head to head.</media:description></media:group>
  </entry>
</feed>`;

function fakeHttp(responses: Record<string, string>): PoliteHttp {
  return {
    async get(url) {
      const body = responses[url];
      if (!body) throw new Error(`unexpected ${url}`);
      return { url, status: 200, body, headers: new Headers() };
    },
    async isAllowed() {
      return true;
    },
  };
}

describe('parseYouTubeRss', () => {
  it('extracts videoId, title, description, channelId, publishedAt', () => {
    const entries = parseYouTubeRss(MKBHD_FEED);
    expect(entries).toHaveLength(3);
    expect(entries[0]!.videoId).toBe('ABC123');
    expect(entries[0]!.title).toContain('Galaxy S25 Ultra');
    expect(entries[0]!.description).toContain('Full review');
    expect(entries[0]!.url).toBe('https://www.youtube.com/watch?v=ABC123');
    expect(entries[0]!.publishedAt).toContain('2025-03-01');
    expect(entries[0]!.channelId).toBe('UCBJycsmduvYEL83R_U4JriQ');
  });
});

describe('YouTubeChannelAdapter.discover', () => {
  const mkbhd = {
    handle: 'MKBHD',
    channelId: 'UCBJycsmduvYEL83R_U4JriQ',
  };
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(mkbhd.channelId)}`;

  it('returns videos that match the target phone by alias', async () => {
    const adapter = new YouTubeChannelAdapter({
      http: fakeHttp({ [feedUrl]: MKBHD_FEED }),
      creators: [mkbhd],
      aliases: ALIASES,
      inner: new YouTubeAdapter(),
    });
    const out = await adapter.discover(s25Ultra, { limit: 5 });
    // Two of three feed entries should match S25 Ultra (review + comparison).
    const videoIds = out.map((c) => (c.raw as { videoId: string }).videoId);
    expect(videoIds).toContain('ABC123');
    expect(videoIds).toContain('GHI789');
    expect(videoIds).not.toContain('DEF456'); // no match
  });

  it('skips creators whose feed fetch fails', async () => {
    const adapter = new YouTubeChannelAdapter({
      http: fakeHttp({}),
      creators: [mkbhd],
      aliases: ALIASES,
    });
    const out = await adapter.discover(s25Ultra, { limit: 5 });
    expect(out).toEqual([]);
  });

  it('records aliasMatches metadata on candidates', async () => {
    const adapter = new YouTubeChannelAdapter({
      http: fakeHttp({ [feedUrl]: MKBHD_FEED }),
      creators: [mkbhd],
      aliases: ALIASES,
    });
    const out = await adapter.discover(s25Ultra, { limit: 5 });
    const comparison = out.find((c) => (c.raw as { videoId: string }).videoId === 'GHI789');
    expect(comparison).toBeDefined();
    expect((comparison!.raw as { aliasMatchCount: number }).aliasMatchCount).toBeGreaterThanOrEqual(
      2,
    );
  });

  it('honours limit parameter', async () => {
    const adapter = new YouTubeChannelAdapter({
      http: fakeHttp({ [feedUrl]: MKBHD_FEED }),
      creators: [mkbhd],
      aliases: ALIASES,
    });
    const out = await adapter.discover(s25Ultra, { limit: 1 });
    expect(out).toHaveLength(1);
  });

  it('caches RSS feeds per channelId', async () => {
    let calls = 0;
    const http: PoliteHttp = {
      async get(url) {
        calls += 1;
        return { url, status: 200, body: MKBHD_FEED, headers: new Headers() };
      },
      async isAllowed() {
        return true;
      },
    };
    const cache = new Map<string, readonly RssEntry[]>();
    const adapter = new YouTubeChannelAdapter({
      http,
      creators: [mkbhd],
      aliases: ALIASES,
      feedCache: cache,
    });
    await adapter.discover(s25Ultra, { limit: 5 });
    await adapter.discover(s25Ultra, { limit: 5 });
    expect(calls).toBe(1);
  });

  it('bypasses robots only for the public feed request', async () => {
    let bypassRobots: boolean | undefined;
    const http: PoliteHttp = {
      async get(url, opts) {
        bypassRobots = opts?.bypassRobots;
        return { url, status: 200, body: MKBHD_FEED, headers: new Headers() };
      },
      async isAllowed() {
        return true;
      },
    };
    const adapter = new YouTubeChannelAdapter({
      http,
      creators: [mkbhd],
      aliases: ALIASES,
    });
    await adapter.discover(s25Ultra, { limit: 5 });
    expect(bypassRobots).toBe(true);
  });

  it('caches failed RSS feeds for the rest of the run', async () => {
    let calls = 0;
    const http: PoliteHttp = {
      async get() {
        calls += 1;
        throw new Error('HTTP 404 feed not found');
      },
      async isAllowed() {
        return true;
      },
    };
    const adapter = new YouTubeChannelAdapter({
      http,
      creators: [mkbhd],
      aliases: ALIASES,
    });
    await adapter.discover(s25Ultra, { limit: 5 });
    await adapter.discover(s25Ultra, { limit: 5 });
    expect(calls).toBe(1);
  });
});

describe('extractCandidatePhonesFromTitle', () => {
  it('extracts Apple iPhone 18 Pro and Pro Max from review titles', () => {
    const r1 = extractCandidatePhonesFromTitle(
      'iPhone 18 Pro Review: All About that Chip',
      '2026-09-12T10:00:00Z',
    );
    expect(r1).toEqual([{ brand: 'Apple', model: 'iPhone 18 Pro', year: 2026 }]);

    const r2 = extractCandidatePhonesFromTitle(
      'iPhone 18 Pro Max - 1 Week Later!',
      '2026-09-15T12:00:00Z',
    );
    expect(r2).toEqual([{ brand: 'Apple', model: 'iPhone 18 Pro Max', year: 2026 }]);
  });

  it('extracts novel models like iPhone Duo', () => {
    const r = extractCandidatePhonesFromTitle(
      'iPhone Duo Impressions: What We Missed!',
      '2026-09-10T10:00:00Z',
    );
    expect(r).toEqual([{ brand: 'Apple', model: 'iPhone Duo', year: 2026 }]);
  });

  it('extracts multiple devices when mentioned in comparison titles', () => {
    const r = extractCandidatePhonesFromTitle(
      'iPhone 18 Pro/Duo Impressions: Mogged',
      '2026-09-11T10:00:00Z',
    );
    expect(r).toEqual([
      { brand: 'Apple', model: 'iPhone 18 Pro', year: 2026 },
      { brand: 'Apple', model: 'iPhone Duo', year: 2026 },
    ]);
  });

  it('extracts modern flagships from Samsung and Google', () => {
    const s = extractCandidatePhonesFromTitle(
      'Galaxy S26 Ultra - Don’t Buy Yet!',
      '2026-02-15T10:00:00Z',
    );
    expect(s).toEqual([{ brand: 'Samsung', model: 'Galaxy S26 Ultra', year: 2026 }]);

    const g = extractCandidatePhonesFromTitle(
      'Google Pixel 11 Pro Review: Poker Face',
      '2026-08-15T10:00:00Z',
    );
    expect(g).toEqual([{ brand: 'Google', model: 'Pixel 11 Pro', year: 2026 }]);
  });

  it('extracts Nothing Phone and CMF Phone models including alphanumeric variants', () => {
    const n1 = extractCandidatePhonesFromTitle(
      'Nothing Phone (2a) Review: The Real Deal',
      '2024-03-05T10:00:00Z',
    );
    expect(n1).toEqual([{ brand: 'Nothing', model: 'Nothing Phone (2a)', year: 2024 }]);

    const n2 = extractCandidatePhonesFromTitle(
      'Nothing Phone 2a Plus - A Worthy Upgrade?',
      '2024-08-01T10:00:00Z',
    );
    expect(n2).toEqual([{ brand: 'Nothing', model: 'Nothing Phone 2a Plus', year: 2024 }]);

    const n3 = extractCandidatePhonesFromTitle(
      'CMF Phone 1 Review: Cheap Done Right',
      '2024-07-12T10:00:00Z',
    );
    expect(n3).toEqual([{ brand: 'Nothing', model: 'CMF Phone 1', year: 2024 }]);

    const n4 = extractCandidatePhonesFromTitle(
      'Nothing Phone (3a) Pro Leaks & Everything We Know',
      '2025-02-15T10:00:00Z',
    );
    expect(n4).toEqual([{ brand: 'Nothing', model: 'Nothing Phone (3a) Pro', year: 2025 }]);
  });

  it('returns empty array for non-phone videos', () => {
    expect(extractCandidatePhonesFromTitle('My camera setup 2025')).toEqual([]);
    expect(extractCandidatePhonesFromTitle('I Made a Bet with Tesla')).toEqual([]);
    expect(extractCandidatePhonesFromTitle('The Wildest Camera Robot')).toEqual([]);
  });
});

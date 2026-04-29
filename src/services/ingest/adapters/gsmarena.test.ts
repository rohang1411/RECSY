import { describe, expect, it } from 'vitest';

import type { PoliteHttp } from '../http';
import type { PhoneRef, SourceCandidate } from '../types';
import {
  GsmArenaAdapter,
  buildSearchUrl,
  canonicalUrl,
  firstDevicePathFromSearch,
  isGsmarenaUrl,
  reviewLinksFromDevicePage,
} from './gsmarena';

const phone: PhoneRef = {
  id: 'p1',
  slug: 'samsung-galaxy-s25-ultra',
  brand: 'Samsung',
  model: 'Galaxy S25 Ultra',
  launchDate: '2025-02-22',
};

describe('gsmarena helpers', () => {
  it('isGsmarenaUrl', () => {
    expect(isGsmarenaUrl('https://www.gsmarena.com/x-review-123.php')).toBe(true);
    expect(isGsmarenaUrl('https://gsmarena.com/x')).toBe(true);
    expect(isGsmarenaUrl('https://example.com')).toBe(false);
    expect(isGsmarenaUrl('not a url')).toBe(false);
  });

  it('canonicalUrl normalises host and strips tracking params', () => {
    expect(canonicalUrl('https://gsmarena.com/foo.php?utm_source=x#section')).toBe(
      'https://www.gsmarena.com/foo.php',
    );
  });

  it('buildSearchUrl encodes brand+model', () => {
    const url = buildSearchUrl(phone);
    expect(url).toContain('res.php3');
    expect(url.toLowerCase()).toContain('samsung');
    expect(url.toLowerCase()).toContain('galaxy');
  });

  it('firstDevicePathFromSearch finds numeric device slug', () => {
    const html = `
      <html><body>
        <a href="/samsung_galaxy_s25_ultra-13559.php">Samsung Galaxy S25 Ultra</a>
        <a href="/other-page.php">ignored</a>
      </body></html>`;
    expect(firstDevicePathFromSearch(html)).toBe('/samsung_galaxy_s25_ultra-13559.php');
  });

  it('firstDevicePathFromSearch returns null on no match', () => {
    expect(firstDevicePathFromSearch('<html>nothing</html>')).toBeNull();
  });

  it('reviewLinksFromDevicePage finds review links and dedupes', () => {
    const html = `
      <a href="samsung_galaxy_s25_ultra-review-2935.php">Review</a>
      <a href="samsung_galaxy_s25_ultra-review-2935.php">duplicate</a>
      <a href="samsung_galaxy_s25_ultra-review-3000.php">Camera review</a>
      <a href="unrelated.php">no</a>`;
    const links = reviewLinksFromDevicePage(html);
    expect(links).toEqual([
      'samsung_galaxy_s25_ultra-review-2935.php',
      'samsung_galaxy_s25_ultra-review-3000.php',
    ]);
  });
});

function fakeHttp(responses: Record<string, { body: string; status?: number }>): {
  http: PoliteHttp;
  calls: string[];
} {
  const calls: string[] = [];
  const http: PoliteHttp = {
    async get(url) {
      calls.push(url);
      const match = responses[url];
      if (!match) throw new Error(`unexpected url: ${url}`);
      return {
        url,
        status: match.status ?? 200,
        body: match.body,
        headers: new Headers(),
      };
    },
    async isAllowed() {
      return true;
    },
  };
  return { http, calls };
}

describe('GsmArenaAdapter.discover', () => {
  it('uses rawJson override when available', async () => {
    const { http } = fakeHttp({});
    const adapter = new GsmArenaAdapter({
      http,
      getPhoneRawJson: async () => ({
        gsmarenaUrl: 'https://www.gsmarena.com/samsung_galaxy_s25_ultra-review-2999.php',
      }),
      maxCandidates: 1,
    });

    const got = await adapter.discover(phone, { limit: 5 });
    expect(got).toHaveLength(1);
    expect(got[0]!.url).toContain('review-2999.php');
    expect((got[0]!.raw as { discoveredVia: string }).discoveredVia).toBe('rawJson-override');
  });

  it('falls back to res.php3 + device page scrape', async () => {
    const { http, calls } = fakeHttp({
      [buildSearchUrl(phone)]: {
        body: '<a href="/samsung_galaxy_s25_ultra-13559.php">match</a>',
      },
      'https://www.gsmarena.com/samsung_galaxy_s25_ultra-13559.php': {
        body: `<a href="samsung_galaxy_s25_ultra-review-2935.php">Review</a>`,
      },
    });
    const adapter = new GsmArenaAdapter({ http });

    const got = await adapter.discover(phone, { limit: 3 });
    expect(calls).toHaveLength(2);
    expect(got).toHaveLength(1);
    expect(got[0]!.url).toBe('https://www.gsmarena.com/samsung_galaxy_s25_ultra-review-2935.php');
  });

  it('returns [] when search yields no device page', async () => {
    const { http } = fakeHttp({
      [buildSearchUrl(phone)]: { body: '<html>nothing</html>' },
    });
    const adapter = new GsmArenaAdapter({ http });
    const got = await adapter.discover(phone, { limit: 3 });
    expect(got).toEqual([]);
  });
});

describe('GsmArenaAdapter.fetch', () => {
  it('throws on non-gsmarena URLs', async () => {
    const { http } = fakeHttp({});
    const adapter = new GsmArenaAdapter({ http });
    const candidate: SourceCandidate = {
      url: 'https://example.com/a',
      title: 't',
      author: null,
      channel: null,
      language: 'en',
      publishedAt: null,
      raw: {},
    };
    await expect(adapter.fetch(candidate)).rejects.toThrow(/not a gsmarena url/);
  });
});

describe('GsmArenaAdapter.chunk', () => {
  it('splits body into chunks', () => {
    const adapter = new GsmArenaAdapter({ http: fakeHttp({}).http });
    const raw = {
      candidate: {
        url: 'https://www.gsmarena.com/x-review-1.php',
        title: 't',
        author: null,
        channel: 'GSMArena',
        language: 'en',
        publishedAt: null,
        raw: {},
      },
      body: 'A short body. Another sentence. Yet another sentence.'.repeat(50),
      contentHash: 'h',
      raw: {},
    };
    const chunks = adapter.chunk(raw);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.chunkIndex).toBe(0);
  });
});

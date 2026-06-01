import { afterEach, describe, expect, it, vi } from 'vitest';

const { structuredMock } = vi.hoisted(() => ({
  structuredMock: vi.fn(),
}));

vi.mock('@/services/llm', () => ({
  llm: {
    structured: structuredMock,
  },
}));

import {
  buildSearchVariants,
  fetchWikipediaSpecs,
  fetchWikitext,
  pickBestTitle,
  searchPhoneTitle,
} from './wikipedia';

const SPEC = {
  display: { size_in: 6.3, resolution: '2622x1206' },
  chipset: 'Apple A19 Pro',
  ram_gb: 12,
  storage_options_gb: [256, 512, 1024],
  rear_cameras: [{ type: 'main' as const, mp: 48 }],
  battery_mah: 4800,
  charging: {},
  connectivity: {},
  os: 'iOS 26',
};

describe('Wikipedia catalog adapter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    structuredMock.mockReset();
  });

  it('requests redirected wikitext from the parse API', async () => {
    let requestedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requestedUrl = url;
        return new Response(
          JSON.stringify({
            parse: { title: 'IPhone 17 Pro', wikitext: { '*': '{{Infobox mobile phone}}' } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const result = await fetchWikitext('IPhone 17 Pro Max');

    expect(result).toMatchObject({ title: 'IPhone 17 Pro' });
    expect(new URL(requestedUrl).searchParams.get('redirects')).toBe('1');
  });

  it('builds deduped query variants without repeating brand tokens', () => {
    expect(buildSearchVariants('Honor', 'Honor Power2')).toEqual(['Honor Power2', 'Power2']);
    expect(buildSearchVariants('Apple', 'iPhone 17 Pro Max')).toEqual([
      'iPhone 17 Pro Max',
      'Apple iPhone 17 Pro Max',
    ]);
  });

  it('rejects mismatched generation titles', () => {
    expect(pickBestTitle(['Apple iPhone 15 Pro Max'], 'Apple', 'iPhone 17 Pro Max')).toBeNull();
    expect(pickBestTitle(['IPhone 17 Pro'], 'Apple', 'iPhone 17 Pro Max')).toBe('IPhone 17 Pro');
  });

  it('prefers canonical full-text results over wrong opensearch matches', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get('list') === 'search') {
          return new Response(JSON.stringify({ query: { search: [{ title: 'IPhone 17 Pro' }] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(['q', ['Apple iPhone 15 Pro Max'], [], []]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await expect(searchPhoneTitle('Apple', 'iPhone 17 Pro Max')).resolves.toBe('IPhone 17 Pro');
  });

  it('returns null when search results do not match the model tokens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get('list') === 'search') {
          return new Response(
            JSON.stringify({
              query: { search: [{ title: 'Anne Finucane' }, { title: 'PowerPC G4' }] },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify(['q', [], [], []]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await expect(searchPhoneTitle('Honor', 'Honor Power2')).resolves.toBeNull();
  });

  it('returns specs with diagnostics when an infobox is parsed', async () => {
    structuredMock.mockResolvedValue({ value: SPEC });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get('list') === 'search') {
          return new Response(JSON.stringify({ query: { search: [{ title: 'IPhone 17 Pro' }] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        if (parsed.searchParams.get('action') === 'opensearch') {
          return new Response(JSON.stringify(['q', [], [], []]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            parse: {
              title: 'IPhone 17 Pro',
              wikitext: { '*': '{{Infobox mobile phone\n| name = iPhone 17 Pro\n}}' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const result = await fetchWikipediaSpecs('Apple', 'iPhone 17 Pro Max');

    expect(result.spec).toMatchObject({ chipset: 'Apple A19 Pro' });
    expect(result.diagnostics).toMatchObject({
      queriesTried: ['iPhone 17 Pro Max'],
      matchedTitle: 'IPhone 17 Pro',
      infobox: 'found',
      llmAttempted: true,
    });
    expect(result.diagnostics.specFieldCount).toBeGreaterThan(0);
  });
});

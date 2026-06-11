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
    expect(pickBestTitle(['POWER2'], 'Honor', 'Honor Power2')).toBeNull();
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
    expect(structuredMock).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 6000 }));
  });

  it('extracts core specs deterministically before using the LLM', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const parsed = new URL(url);
        if (parsed.searchParams.get('list') === 'search') {
          return new Response(
            JSON.stringify({ query: { search: [{ title: 'Example Phone Pro' }] } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
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
              title: 'Example Phone Pro',
              wikitext: {
                '*': [
                  '{{Infobox mobile phone',
                  '| display = 6.3 in 2622 x 1206 OLED 120 Hz',
                  '| soc = Example X1',
                  '| memory = 12 GB RAM',
                  '| storage = 256 GB, 512 GB, 1 TB',
                  '| battery = 5000 mAh',
                  '| rear_camera = 50 MP wide camera with OIS',
                  '| front_camera = 12 MP',
                  '| os = Android 16',
                  '| charging = 45 W wired',
                  '| connectivity = Wi-Fi 7, Bluetooth 5.4, NFC, USB-C',
                  '}}',
                ].join('\n'),
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const result = await fetchWikipediaSpecs('Example', 'Phone Pro');

    expect(result.spec).toMatchObject({
      chipset: 'Example X1',
      ram_gb: 12,
      storage_options_gb: [256, 512, 1024],
      battery_mah: 5000,
      os: 'Android 16',
    });
    expect(result.diagnostics).toMatchObject({
      extractionMethod: 'deterministic',
      llmAttempted: false,
    });
    expect(structuredMock).not.toHaveBeenCalled();
  });

  it('extracts core specs from Wikipedia template-heavy iPhone-style infoboxes', async () => {
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
              wikitext: {
                '*': [
                  '{{Infobox mobile phone',
                  '| soc = [[Apple A19|Apple A19 Pro]]',
                  '| memory = 12 GB [[LPDDR5X]]',
                  '| storage = {{ubl|256 GB|512 GB|1 TB|2 TB (Pro Max only)}}[[NVMe]]',
                  '| battery = {{ubl|Pro: 3988 mAh|Pro Max: 5088 mAh}}',
                  '| display = {{ubl|Pro: {{convert|6.3|in|mm|0|abbr=on}} {{resx|2622|1206}}-pixel resolution|Pro Max: {{convert|6.9|in|mm|0|abbr=on}} {{resx|2868|1320}}-pixel resolution|ProMotion technology up to 120 Hz}}',
                  '| os = Original: [[iOS 26]]',
                  '| rear_camera = {{Ubl|Fusion Main: 48MP, {{f/}}1.78, 24mm (wide)|Fusion Ultrawide: 48MP, {{f/}}2.2}}',
                  '| front_camera = {{Ubl|18MP Centre Stage camera}}',
                  '| charging = Up to 50% charge in 20 minutes with 40 W adaptor',
                  '| connectivity = [[Wi-Fi 7]], [[Bluetooth 6.0]], [[Near-field communication|NFC]], [[USB-C]]',
                  '| water_resist = [[IP68]] dust/water resistant',
                  '}}',
                ].join('\n'),
              },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const result = await fetchWikipediaSpecs('Apple', 'iPhone 17 Pro Max');

    expect(result.spec).toMatchObject({
      chipset: 'Apple A19 Pro',
      ram_gb: 12,
      storage_options_gb: [256, 512, 1024, 2048],
      battery_mah: 3988,
      os: 'Original: iOS 26',
      rear_cameras: [{ type: 'main', mp: 48 }],
    });
    expect(result.spec?.display).toMatchObject({
      size_in: 6.3,
      resolution: '2622x1206',
      refresh_rate_hz: 120,
    });
    expect(result.diagnostics.extractionMethod).toBe('deterministic');
    expect(structuredMock).not.toHaveBeenCalled();
  });
});

/**
 * Unit tests for Wikidata catalog discovery.
 *
 * Tests cover: bounded query generation and mapping a fixture response without
 * making live network calls.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPhoneNameQuery,
  buildRecentPhonesQuery,
  discoverRecentWikidataPhones,
  findWikidataPhonesByName,
} from './wikidata';

describe('Wikidata catalog adapter', () => {
  it('builds a bounded recent-phone query', () => {
    const query = buildRecentPhonesQuery(
      new Date('2024-05-18T00:00:00Z'),
      999,
      new Date('2026-05-31T12:00:00Z'),
    );
    expect(query).toContain('2024-05-18');
    expect(query).toContain('2026-06-01');
    expect(query).toContain('LIMIT 500');
    expect(query).toContain('?item wdt:P31 ?class.');
    expect(query).not.toContain('P279*');
  });

  it('builds a bounded phone-name lookup query for media backfill', () => {
    const query = buildPhoneNameQuery('Apple', 'iPhone 16 Pro', 99);
    expect(query).toContain('iphone 16 pro');
    expect(query).toContain('apple iphone 16 pro');
    expect(query).toContain('LIMIT 25');
    expect(query).toContain('OPTIONAL { ?item wdt:P18 ?image. }');
  });

  it('maps fixture response into candidates', async () => {
    const candidates = await discoverRecentWikidataPhones({
      since: new Date('2024-01-01T00:00:00Z'),
      limit: 1,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: {
              bindings: [
                {
                  item: { value: 'http://www.wikidata.org/entity/Q123' },
                  itemLabel: { value: 'Example Phone Pro' },
                  manufacturerLabel: { value: 'Example' },
                  releaseDate: { value: '2025-01-01T00:00:00Z' },
                  officialWebsite: { value: 'https://example.com/phone' },
                  aliases: { value: 'Example Pro|ExamplePhonePro' },
                },
                {
                  item: { value: 'http://www.wikidata.org/entity/Q123' },
                  itemLabel: { value: 'Example Phone Pro' },
                  manufacturerLabel: { value: 'Example' },
                  releaseDate: { value: '2025-01-01T00:00:00Z' },
                  officialWebsite: { value: 'https://example.com/phone-alt' },
                  aliases: { value: 'Example Pro Alt' },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: 'Q123',
      title: 'Example Phone Pro',
      brand: 'Example',
    });
    expect(candidates[0]?.aliases).toEqual(['Example Pro', 'ExamplePhonePro', 'Example Pro Alt']);
  });

  it('maps phone-name lookup fixture responses into image candidates', async () => {
    const candidates = await findWikidataPhonesByName({
      brand: 'Google',
      model: 'Pixel 9 Pro',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: {
              bindings: [
                {
                  item: { value: 'http://www.wikidata.org/entity/Q789' },
                  itemLabel: { value: 'Google Pixel 9 Pro' },
                  manufacturerLabel: { value: 'Google LLC' },
                  releaseDate: { value: '2024-08-22T00:00:00Z' },
                  image: { value: 'https://upload.wikimedia.org/pixel-9-pro.jpg' },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    expect(candidates[0]).toMatchObject({
      externalId: 'Q789',
      brand: 'Google',
      imageUrl: 'https://upload.wikimedia.org/pixel-9-pro.jpg',
    });
  });

  it('prefers consumer brands over contract manufacturers for duplicate bindings', async () => {
    const candidates = await discoverRecentWikidataPhones({
      since: new Date('2026-01-01T00:00:00Z'),
      limit: 2,
      now: new Date('2026-10-01T00:00:00Z'),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: {
              bindings: [
                {
                  item: { value: 'http://www.wikidata.org/entity/Q999' },
                  itemLabel: { value: 'iPhone 17 Pro Max' },
                  manufacturerLabel: { value: 'Foxconn' },
                  releaseDate: { value: '2026-09-01T00:00:00Z' },
                  officialWebsite: { value: 'https://www.apple.com/befr/iphone-17-pro/' },
                },
                {
                  item: { value: 'http://www.wikidata.org/entity/Q999' },
                  itemLabel: { value: 'iPhone 17 Pro Max' },
                  manufacturerLabel: { value: 'Apple Inc.' },
                  releaseDate: { value: '2026-09-01T00:00:00Z' },
                  officialWebsite: { value: 'https://www.apple.com/iphone-17-pro/' },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      externalId: 'Q999',
      title: 'iPhone 17 Pro Max',
      brand: 'Apple',
    });
    expect(candidates[0]?.raw.duplicateBindings).toHaveLength(1);
  });

  it('infers brand from recognizable title when manufacturer is absent', async () => {
    const candidates = await discoverRecentWikidataPhones({
      since: new Date('2025-01-01T00:00:00Z'),
      limit: 1,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: {
              bindings: [
                {
                  item: { value: 'http://www.wikidata.org/entity/Q456' },
                  itemLabel: { value: 'Light Phone III' },
                  releaseDate: { value: '2025-03-01T00:00:00Z' },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    expect(candidates[0]).toMatchObject({
      externalId: 'Q456',
      brand: 'Light',
      model: 'Light Phone III',
    });
  });

  it('filters obvious non-phone devices from discovery', async () => {
    const candidates = await discoverRecentWikidataPhones({
      since: new Date('2026-01-01T00:00:00Z'),
      limit: 2,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: {
              bindings: [
                {
                  item: { value: 'http://www.wikidata.org/entity/Q100' },
                  itemLabel: { value: 'iPad Air 11 2026' },
                  manufacturerLabel: { value: 'Apple Inc.' },
                  releaseDate: { value: '2026-05-01T00:00:00Z' },
                },
                {
                  item: { value: 'http://www.wikidata.org/entity/Q102' },
                  itemLabel: { value: '8849 Tank Pad' },
                  manufacturerLabel: { value: '8849' },
                  releaseDate: { value: '2026-01-01T00:00:00Z' },
                },
                {
                  item: { value: 'http://www.wikidata.org/entity/Q101' },
                  itemLabel: { value: 'iPhone 17 Pro Max' },
                  manufacturerLabel: { value: 'Apple Inc.' },
                  releaseDate: { value: '2025-09-19T00:00:00Z' },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('iPhone 17 Pro Max');
  });

  it('filters unreleased future-dated devices from discovery', async () => {
    const candidates = await discoverRecentWikidataPhones({
      since: new Date('2026-01-01T00:00:00Z'),
      limit: 2,
      now: new Date('2026-05-31T12:00:00Z'),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            results: {
              bindings: [
                {
                  item: { value: 'http://www.wikidata.org/entity/Q200' },
                  itemLabel: { value: 'iPhone 17 Pro Max' },
                  manufacturerLabel: { value: 'Apple Inc.' },
                  releaseDate: { value: '2026-09-19T00:00:00Z' },
                },
                {
                  item: { value: 'http://www.wikidata.org/entity/Q201' },
                  itemLabel: { value: 'Samsung Galaxy S25 Edge' },
                  manufacturerLabel: { value: 'Samsung Electronics' },
                  releaseDate: { value: '2026-05-30T00:00:00Z' },
                },
              ],
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.title).toBe('Samsung Galaxy S25 Edge');
  });
});

/**
 * Unit tests for Wikidata catalog discovery.
 *
 * Tests cover: bounded query generation and mapping a fixture response without
 * making live network calls.
 */
import { describe, expect, it } from 'vitest';

import { buildRecentPhonesQuery, discoverRecentWikidataPhones } from './wikidata';

describe('Wikidata catalog adapter', () => {
  it('builds a bounded recent-phone query', () => {
    const query = buildRecentPhonesQuery(new Date('2024-05-18T00:00:00Z'), 999);
    expect(query).toContain('2024-05-18');
    expect(query).toContain('LIMIT 500');
    expect(query).toContain('?item wdt:P31 ?class.');
    expect(query).not.toContain('P279*');
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
});

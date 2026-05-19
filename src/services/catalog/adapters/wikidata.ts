/**
 * Wikidata catalog discovery adapter.
 *
 * Purpose: discover recently released smartphone-like entities without LLM
 * calls. Wikidata is used as an open discovery signal, not as a complete spec
 * source for auto-promotion.
 *
 * Used by: `scripts/catalog-refresh.ts`.
 */
import { z } from 'zod';

import type { WikidataPhoneCandidate } from '../types';

const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql';
const ENTITY_BASE = 'https://www.wikidata.org/wiki/';

const BindingSchema = z.object({
  item: z.object({ value: z.string().url() }),
  itemLabel: z.object({ value: z.string().min(1) }),
  manufacturerLabel: z.object({ value: z.string().min(1) }).optional(),
  releaseDate: z.object({ value: z.string() }).optional(),
  officialWebsite: z.object({ value: z.string().url() }).optional(),
  image: z.object({ value: z.string().url() }).optional(),
  aliases: z.object({ value: z.string() }).optional(),
});

const WikidataResponseSchema = z.object({
  results: z.object({
    bindings: z.array(BindingSchema),
  }),
});

export interface WikidataCatalogOptions {
  readonly since: Date;
  readonly limit: number;
  readonly userAgent?: string;
  readonly fetchImpl?: typeof fetch;
}

export async function discoverRecentWikidataPhones(
  options: WikidataCatalogOptions,
): Promise<WikidataPhoneCandidate[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const query = buildRecentPhonesQuery(options.since, options.limit);
  const url = new URL(WDQS_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('query', query);

  const res = await fetcher(url, {
    headers: {
      accept: 'application/sparql-results+json',
      'user-agent':
        options.userAgent ??
        'RECSYBot/0.1 (https://github.com/rohang1411/RECSY; catalog discovery)',
    },
  });
  if (!res.ok) {
    throw new Error(`Wikidata query failed: HTTP ${res.status}`);
  }
  const parsed = WikidataResponseSchema.parse(await res.json());
  return dedupeCandidates(parsed.results.bindings.map(mapBinding));
}

export function buildRecentPhonesQuery(since: Date, limit: number): string {
  const date = since.toISOString().slice(0, 10);
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  return `
SELECT ?item ?itemLabel ?manufacturerLabel ?releaseDate ?officialWebsite ?image
       (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
WHERE {
  VALUES ?class { wd:Q17517 wd:Q22645 wd:Q19723444 }
  ?item wdt:P577 ?releaseDate.
  ?item wdt:P31 ?class.
  FILTER(?releaseDate >= "${date}"^^xsd:dateTime)
  OPTIONAL { ?item wdt:P176 ?manufacturer. }
  OPTIONAL { ?item wdt:P856 ?officialWebsite. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item skos:altLabel ?alias FILTER(LANG(?alias) = "en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?item ?itemLabel ?manufacturerLabel ?releaseDate ?officialWebsite ?image
ORDER BY DESC(?releaseDate)
LIMIT ${boundedLimit}
`.trim();
}

function mapBinding(binding: z.infer<typeof BindingSchema>): WikidataPhoneCandidate {
  const qid = binding.item.value.split('/').pop() ?? binding.item.value;
  const aliases = binding.aliases?.value
    ? binding.aliases.value
        .split('|')
        .map((a) => a.trim())
        .filter(Boolean)
    : [];
  return {
    sourceKey: 'wikidata',
    sourceType: 'wikidata',
    externalId: qid,
    sourceUrl: `${ENTITY_BASE}${qid}`,
    title: binding.itemLabel.value,
    brand: binding.manufacturerLabel?.value ?? null,
    model: binding.itemLabel.value,
    releaseDate: binding.releaseDate?.value ?? null,
    officialUrl: binding.officialWebsite?.value ?? null,
    imageUrl: binding.image?.value ?? null,
    aliases,
    raw: {
      qid,
      item: binding.item.value,
      label: binding.itemLabel.value,
      manufacturer: binding.manufacturerLabel?.value ?? null,
      releaseDate: binding.releaseDate?.value ?? null,
      officialWebsite: binding.officialWebsite?.value ?? null,
      image: binding.image?.value ?? null,
      aliases,
    },
  };
}

function dedupeCandidates(candidates: readonly WikidataPhoneCandidate[]): WikidataPhoneCandidate[] {
  const byQid = new Map<string, WikidataPhoneCandidate>();
  for (const candidate of candidates) {
    const existing = byQid.get(candidate.externalId);
    if (!existing) {
      byQid.set(candidate.externalId, candidate);
      continue;
    }

    byQid.set(candidate.externalId, {
      ...existing,
      brand: existing.brand ?? candidate.brand,
      officialUrl: existing.officialUrl ?? candidate.officialUrl,
      imageUrl: existing.imageUrl ?? candidate.imageUrl,
      aliases: [...new Set([...existing.aliases, ...candidate.aliases])],
      raw: {
        ...existing.raw,
        duplicateBindings: [
          ...readDuplicateBindings(existing.raw.duplicateBindings),
          candidate.raw,
        ],
      },
    });
  }
  return [...byQid.values()];
}

function readDuplicateBindings(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => {
    return item != null && typeof item === 'object' && !Array.isArray(item);
  });
}

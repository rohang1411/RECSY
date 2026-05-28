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

import { brandPriorityRank } from '../brand-priority';
import { normalizeIdentityText } from '../identity';
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

export interface WikidataPhoneNameOptions {
  readonly brand: string;
  readonly model: string;
  readonly limit?: number;
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
  return dedupeCandidates(parsed.results.bindings.map(mapBinding)).filter((candidate) =>
    isLikelyPhoneTitle(candidate.title),
  );
}

export async function findWikidataPhonesByName(
  options: WikidataPhoneNameOptions,
): Promise<WikidataPhoneCandidate[]> {
  const fetcher = options.fetchImpl ?? fetch;
  const query = buildPhoneNameQuery(options.brand, options.model, options.limit ?? 10);
  const url = new URL(WDQS_ENDPOINT);
  url.searchParams.set('format', 'json');
  url.searchParams.set('query', query);

  const res = await fetcher(url, {
    headers: {
      accept: 'application/sparql-results+json',
      'user-agent':
        options.userAgent ??
        'RECSYBot/0.1 (https://github.com/rohang1411/RECSY; catalog media backfill)',
    },
  });
  if (!res.ok) {
    throw new Error(`Wikidata phone lookup failed: HTTP ${res.status}`);
  }
  const parsed = WikidataResponseSchema.parse(await res.json());
  return dedupeCandidates(parsed.results.bindings.map(mapBinding)).filter((candidate) =>
    isLikelyPhoneTitle(candidate.title),
  );
}

export function buildRecentPhonesQuery(since: Date, limit: number): string {
  const date = since.toISOString().slice(0, 10);
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  // Use a UNION of P571 (inception / hardware release date, preferred for
  // devices) and P577 (publication date) so phones that only carry one of
  // the two properties are still discovered.  A BIND + COALESCE ensures the
  // rest of the query can treat ?releaseDate uniformly.
  return `
SELECT ?item ?itemLabel ?manufacturerLabel ?releaseDate ?officialWebsite ?image
       (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
WHERE {
  VALUES ?class { wd:Q17517 wd:Q22645 wd:Q19723444 }
  ?item wdt:P31 ?class.
  {
    ?item wdt:P571 ?releaseDate.
  } UNION {
    ?item wdt:P577 ?releaseDate.
  }
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

export function buildPhoneNameQuery(brand: string, model: string, limit: number): string {
  const boundedLimit = Math.max(1, Math.min(limit, 25));
  const normalizedModel = normalizeIdentityText(stripBrandPrefix(model, brand));
  const normalizedFull = normalizeIdentityText(`${brand} ${model}`);
  const needles = [...new Set([normalizedModel, normalizedFull].filter(Boolean))].map(sparqlString);

  return `
SELECT ?item ?itemLabel ?manufacturerLabel ?releaseDate ?officialWebsite ?image
       (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases)
WHERE {
  VALUES ?class { wd:Q17517 wd:Q22645 wd:Q19723444 }
  ?item wdt:P31 ?class.
  ?item rdfs:label ?rawLabel.
  FILTER(LANG(?rawLabel) = "en")
  BIND(LCASE(STR(?rawLabel)) AS ?labelLower)
  FILTER(${needles.map((needle) => `CONTAINS(?labelLower, ${needle})`).join(' || ')})
  OPTIONAL { ?item wdt:P176 ?manufacturer. }
  OPTIONAL { ?item wdt:P571 ?inceptionDate. }
  OPTIONAL { ?item wdt:P577 ?publicationDate. }
  BIND(COALESCE(?inceptionDate, ?publicationDate) AS ?releaseDate)
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

function stripBrandPrefix(value: string, brandName: string): string {
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return value.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim();
}

function sparqlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function mapBinding(binding: z.infer<typeof BindingSchema>): WikidataPhoneCandidate {
  const qid = binding.item.value.split('/').pop() ?? binding.item.value;
  const title = binding.itemLabel.value;
  const rawManufacturer = binding.manufacturerLabel?.value ?? null;
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
    title,
    brand: normalizeWikidataBrand(rawManufacturer, title),
    model: title,
    releaseDate: binding.releaseDate?.value ?? null,
    officialUrl: binding.officialWebsite?.value ?? null,
    imageUrl: binding.image?.value ?? null,
    aliases,
    raw: {
      qid,
      item: binding.item.value,
      label: title,
      manufacturer: rawManufacturer,
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
      brand: pickBetterBrand(existing.brand, candidate.brand, existing.title),
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

function pickBetterBrand(
  existing: string | null | undefined,
  candidate: string | null | undefined,
  title: string,
): string | null {
  const normalizedExisting = normalizeWikidataBrand(existing ?? null, title);
  const normalizedCandidate = normalizeWikidataBrand(candidate ?? null, title);
  if (!normalizedExisting) return normalizedCandidate;
  if (!normalizedCandidate) return normalizedExisting;

  const existingContract = isContractManufacturer(normalizedExisting);
  const candidateContract = isContractManufacturer(normalizedCandidate);
  if (existingContract && !candidateContract) return normalizedCandidate;
  if (!existingContract && candidateContract) return normalizedExisting;

  const existingRank = brandPriorityRank(normalizedExisting);
  const candidateRank = brandPriorityRank(normalizedCandidate);
  if (candidateRank < existingRank) return normalizedCandidate;
  if (existingRank < candidateRank) return normalizedExisting;

  const titleBrand = inferBrandFromTitle(title);
  if (titleBrand) {
    if (sameNormalizedBrand(normalizedCandidate, titleBrand)) return normalizedCandidate;
    if (sameNormalizedBrand(normalizedExisting, titleBrand)) return normalizedExisting;
  }

  return normalizedExisting;
}

function normalizeWikidataBrand(brand: string | null, title: string): string | null {
  const inferred = inferBrandFromTitle(title);
  const trimmed = brand?.trim();
  if (!trimmed) return inferred;

  const normalized = normalizeIdentityText(trimmed);
  const mapped = COMMON_MANUFACTURER_BRANDS.get(normalized);
  if (mapped) return mapped;
  if (isContractManufacturer(trimmed)) return inferred ?? trimmed;

  return trimmed
    .replace(/\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Co\.?|Company|Ltd\.?|Limited)$/i, '')
    .replace(/\s+(?:Electronics|Technologies|Technology)$/i, '')
    .trim();
}

function inferBrandFromTitle(title: string): string | null {
  const normalized = normalizeIdentityText(title);
  for (const [prefix, brand] of TITLE_BRAND_PREFIXES) {
    if (normalized === prefix || normalized.startsWith(`${prefix} `)) return brand;
  }
  return null;
}

function isContractManufacturer(brand: string): boolean {
  return CONTRACT_MANUFACTURERS.has(normalizeIdentityText(brand));
}

function sameNormalizedBrand(a: string, b: string): boolean {
  return normalizeIdentityText(a) === normalizeIdentityText(b);
}

function isLikelyPhoneTitle(title: string): boolean {
  const normalized = normalizeIdentityText(title);
  if (NON_PHONE_TITLE_TOKENS.some((token) => normalized.includes(token))) return false;
  return true;
}

const CONTRACT_MANUFACTURERS = new Set([
  'foxconn',
  'hon hai precision industry',
  'hon hai precision industry co ltd',
  'pegatron',
  'wistron',
  'compal electronics',
]);

const NON_PHONE_TITLE_TOKENS = [
  'ipad',
  'tablet',
  'pad',
  'etpad',
  'acepad',
  'iconia',
  'watch',
  'macbook',
  'laptop',
  'chromebook',
  'earbuds',
  'headphones',
  'smart tv',
];

const COMMON_MANUFACTURER_BRANDS = new Map<string, string>([
  ['apple inc', 'Apple'],
  ['samsung electronics', 'Samsung'],
  ['samsung electronics co ltd', 'Samsung'],
  ['google llc', 'Google'],
  ['xiaomi corporation', 'Xiaomi'],
  ['oneplus technology shenzhen co ltd', 'OnePlus'],
  ['nothing technology', 'Nothing'],
  ['nothing technology limited', 'Nothing'],
  ['motorola mobility', 'Motorola'],
  ['sony mobile communications', 'Sony'],
  ['honor device co ltd', 'Honor'],
  ['huawei technologies', 'Huawei'],
  ['oppo electronics', 'OPPO'],
  ['vivo mobile communication', 'vivo'],
]);

const TITLE_BRAND_PREFIXES: readonly (readonly [string, string])[] = [
  ['iphone', 'Apple'],
  ['ipad', 'Apple'],
  ['samsung', 'Samsung'],
  ['galaxy', 'Samsung'],
  ['google pixel', 'Google'],
  ['pixel', 'Google'],
  ['nothing phone', 'Nothing'],
  ['cmf phone', 'Nothing'],
  ['oneplus', 'OnePlus'],
  ['vivo', 'vivo'],
  ['iqoo', 'vivo'],
  ['xiaomi', 'Xiaomi'],
  ['redmi', 'Xiaomi'],
  ['poco', 'Xiaomi'],
  ['motorola', 'Motorola'],
  ['moto', 'Motorola'],
  ['honor', 'Honor'],
  ['huawei', 'Huawei'],
  ['oppo', 'OPPO'],
  ['realme', 'Realme'],
  ['sony xperia', 'Sony'],
  ['xperia', 'Sony'],
  ['light phone', 'Light'],
  ['tecno', 'Tecno'],
  ['infinix', 'Infinix'],
  ['itel', 'itel'],
];

function readDuplicateBindings(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => {
    return item != null && typeof item === 'object' && !Array.isArray(item);
  });
}

/**
 * Wikipedia API adapter for phone spec enrichment.
 *
 * Strategy:
 *   1. Search Wikipedia with model-first query variants.
 *   2. Resolve redirects while fetching article wikitext.
 *   3. Extract the `{{Infobox mobile phone}}` block from the wikitext.
 *   4. Use the LLM to convert the raw infobox into a `PhoneSpec` object.
 */
import { env } from '@/env';
import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';
import { llm } from '@/services/llm';

import { normalizeIdentityText } from '../identity';
import {
  findMissingCoreFields,
  projectPhoneSpec,
  type CatalogSpecProjectionInput,
} from '../spec-project';

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

const USER_AGENT =
  'RECSYBot/0.1 (https://github.com/rohan; catalog spec enrichment) contact: github issues';

export interface WikipediaDiagnostics {
  readonly queriesTried: readonly string[];
  readonly matchedTitle: string | null;
  readonly infobox: 'found' | 'missing' | 'no-article';
  readonly specFieldCount: number;
  readonly failureReason?: 'no-article' | 'no-infobox' | 'llm-empty';
  readonly llmAttempted: boolean;
  readonly extractionMethod: 'none' | 'deterministic' | 'llm';
}

export interface WikipediaFetchResult {
  readonly spec: PhoneSpec | null;
  readonly diagnostics: WikipediaDiagnostics;
}

interface SearchTitleResult {
  readonly title: string | null;
  readonly queriesTried: readonly string[];
}

interface WikitextResult {
  readonly title: string | null;
  readonly wikitext: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wikiApiFetch(params: Record<string, string>): Promise<Response> {
  const url = new URL(WIKIPEDIA_API);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
}

export async function searchPhoneTitle(brand: string, model: string): Promise<string | null> {
  return (await searchPhoneTitleWithDiagnostics(brand, model)).title;
}

async function searchPhoneTitleWithDiagnostics(
  brand: string,
  model: string,
): Promise<SearchTitleResult> {
  const queriesTried: string[] = [];
  for (const query of buildSearchVariants(brand, model)) {
    queriesTried.push(query);
    const titles = [...(await fullTextSearch(query)), ...(await openSearch(query))];
    const match = pickBestTitle(titles, brand, model);
    if (match) return { title: match, queriesTried };
    await sleep(250);
  }
  return { title: null, queriesTried };
}

async function fullTextSearch(query: string): Promise<string[]> {
  const res = await wikiApiFetch({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: '5',
    format: 'json',
  });
  if (!res.ok) return [];

  const data = (await res.json()) as { query?: { search?: { title?: string }[] } };
  return (data.query?.search ?? [])
    .map((result) => result.title)
    .filter((title): title is string => Boolean(title));
}

async function openSearch(query: string): Promise<string[]> {
  const res = await wikiApiFetch({
    action: 'opensearch',
    search: query,
    limit: '5',
    format: 'json',
  });
  if (!res.ok) return [];

  const data = (await res.json()) as [string, string[], string[], string[]];
  return data[1] ?? [];
}

export function buildSearchVariants(brand: string, model: string): string[] {
  const cleanBrand = brand.trim();
  const cleanModel = model.trim();
  const strippedModel = stripBrandPrefix(cleanModel, cleanBrand);
  const modelStartsWithBrand = normalizeIdentityText(cleanModel).startsWith(
    `${normalizeIdentityText(cleanBrand)} `,
  );
  return [
    cleanModel,
    strippedModel,
    ...(modelStartsWithBrand ? [] : [`${cleanBrand} ${cleanModel}`.trim()]),
  ].filter(dedupeNonEmpty);
}

export function pickBestTitle(
  titles: readonly string[],
  brand: string,
  model: string,
): string | null {
  const modelTokens = tokenizeTitle(stripBrandPrefix(model, brand));
  const modelNumericTokens = numericTokens(modelTokens);
  const modelWordTokens = modelTokens.filter((token) => !isIgnoredSearchToken(token));
  const titleMustCarryBrandOrPhoneFamily =
    modelStartsWithBrand(model, brand) || isGenericShortModel(modelWordTokens);
  let best: { title: string; score: number } | null = null;

  for (const title of titles) {
    const titleTokens = tokenizeTitle(stripParenthetical(title));
    if (titleMustCarryBrandOrPhoneFamily && !hasBrandOrPhoneFamily(titleTokens, brand)) continue;
    const titleNumericTokens = numericTokens(titleTokens);
    if (hasConflictingGeneration(modelNumericTokens, titleNumericTokens)) continue;

    const hasAllNumeric =
      modelNumericTokens.length === 0 ||
      modelNumericTokens.every((token) => titleNumericTokens.includes(token));
    if (!hasAllNumeric) continue;

    const sharedWordTokens = modelWordTokens.filter((token) => titleTokens.includes(token));
    const hasAllModelWords = modelWordTokens.every((token) => titleTokens.includes(token));
    const isPrefix =
      titleTokens.length > 0 && titleTokens.every((token, index) => token === modelTokens[index]);
    if (!hasAllModelWords && !isPrefix) continue;

    const score =
      (hasAllNumeric ? modelNumericTokens.length * 2 : 0) +
      sharedWordTokens.length +
      (isPrefix ? 2 : 0) +
      (hasAllModelWords ? 2 : 0);
    if (score < 3) continue;
    if (!best || score > best.score) best = { title, score };
  }

  return best?.title ?? null;
}

export async function fetchWikitext(pageTitle: string): Promise<WikitextResult | null> {
  const res = await wikiApiFetch({
    action: 'parse',
    page: pageTitle,
    prop: 'wikitext',
    redirects: '1',
    format: 'json',
  });
  if (!res.ok) return null;

  const data = (await res.json()) as { parse?: { title?: string; wikitext?: { '*'?: string } } };
  const wikitext = data?.parse?.wikitext?.['*'];
  if (!wikitext) return null;
  return { title: data.parse?.title ?? null, wikitext };
}

function extractInfobox(wikitext: string): string | null {
  const startPattern = /\{\{[Ii]nfobox\s+(?:mobile\s+phone|smartphone|phone)/i;
  const startMatch = wikitext.match(startPattern);
  if (!startMatch || startMatch.index === undefined) return null;

  let depth = 0;
  let i = startMatch.index;
  const end = wikitext.length;

  while (i < end) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
      depth++;
      i += 2;
    } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
      depth--;
      i += 2;
      if (depth === 0) break;
    } else {
      i++;
    }
  }

  return wikitext.slice(startMatch.index, i);
}

async function parseInfoboxWithLlm(infoboxWikitext: string): Promise<PhoneSpec | null> {
  const prompt = `You are extracting phone specifications from a raw Wikipedia infobox in wikitext format.
Convert the infobox data into the required JSON schema for a PhoneSpec object.

Rules:
- Only include fields that are clearly present in the infobox. Do NOT invent or guess values.
- Return compact JSON only. Do not include explanatory text.
- Camera entries should be extracted from fields like "camera", "rear camera", "main camera", "back camera".
- Battery capacity (mah) should come from the "battery" field.
- RAM (ram_gb) and storage (storage_options_gb) from "memory", "ram", "storage", or "internal storage" fields.
- Display info (size_in, resolution, refresh_rate_hz, panel_type) from "screen", "display" fields.
- Omit optional fields entirely if the infobox does not contain them.
- Omit display.features, highlights, colors, and long marketing phrases. Keep strings short.
- For storage_options_gb, parse all listed storage variants (e.g. "128 GB, 256 GB, 512 GB") into an array of numbers.
- For ram_gb, use the highest listed RAM variant as a single integer.
- For wired charging watts (wired_w), parse from "charging" or "fast charging" fields if wattage is stated.

Raw Wikipedia infobox wikitext:
${infoboxWikitext}`;

  try {
    const { value } = await llm.structured({
      model: env.LLM_CHAT_MODEL,
      schema: PhoneSpecSchema,
      schemaName: 'PhoneSpec',
      schemaDescription: 'Phone specification data extracted from a Wikipedia infobox.',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      maxOutputTokens: 6000,
    });
    return value;
  } catch (err) {
    console.error('[wikipedia-catalog] LLM structured extraction failed:', err);
    return null;
  }
}

export async function fetchWikipediaSpecs(
  brand: string,
  model: string,
): Promise<WikipediaFetchResult> {
  try {
    const search = await searchPhoneTitleWithDiagnostics(brand, model);
    const pageTitle = search.title;
    if (!pageTitle) {
      return {
        spec: null,
        diagnostics: diagnostics({
          queriesTried: search.queriesTried,
          infobox: 'no-article',
          failureReason: 'no-article',
        }),
      };
    }

    await sleep(1000);

    const wikitextResult = await fetchWikitext(pageTitle);
    if (!wikitextResult) {
      return {
        spec: null,
        diagnostics: diagnostics({
          queriesTried: search.queriesTried,
          matchedTitle: pageTitle,
          infobox: 'no-article',
          failureReason: 'no-article',
        }),
      };
    }

    const infobox = extractInfobox(wikitextResult.wikitext);
    if (!infobox) {
      return {
        spec: null,
        diagnostics: diagnostics({
          queriesTried: search.queriesTried,
          matchedTitle: wikitextResult.title ?? pageTitle,
          infobox: 'missing',
          failureReason: 'no-infobox',
        }),
      };
    }

    const deterministicInput = parseInfoboxDeterministically(infobox);
    const deterministicProjection = projectPhoneSpec(deterministicInput);
    if (deterministicProjection.ok && deterministicProjection.spec) {
      return {
        spec: deterministicProjection.spec,
        diagnostics: diagnostics({
          queriesTried: search.queriesTried,
          matchedTitle: wikitextResult.title ?? pageTitle,
          infobox: 'found',
          specFieldCount: countSpecFields(deterministicProjection.spec),
          extractionMethod: 'deterministic',
        }),
      };
    }

    await sleep(1000);

    const spec = await parseInfoboxWithLlm(infobox);
    if (!spec) {
      console.warn(`[wikipedia-catalog] LLM failed to produce a valid spec for "${pageTitle}"`);
      return {
        spec: null,
        diagnostics: diagnostics({
          queriesTried: search.queriesTried,
          matchedTitle: wikitextResult.title ?? pageTitle,
          infobox: 'found',
          failureReason: 'llm-empty',
          llmAttempted: true,
          extractionMethod: 'llm',
        }),
      };
    }

    return {
      spec,
      diagnostics: diagnostics({
        queriesTried: search.queriesTried,
        matchedTitle: wikitextResult.title ?? pageTitle,
        infobox: 'found',
        specFieldCount: countSpecFields(spec),
        llmAttempted: true,
        extractionMethod: 'llm',
      }),
    };
  } catch (err) {
    console.error(`[wikipedia-catalog] Failed to fetch specs for ${brand} ${model}:`, err);
    return {
      spec: null,
      diagnostics: diagnostics({
        queriesTried: buildSearchVariants(brand, model),
        infobox: 'no-article',
        failureReason: 'no-article',
      }),
    };
  }
}

export async function checkWikipediaAvailability(): Promise<boolean> {
  try {
    const res = await wikiApiFetch({
      action: 'query',
      meta: 'siteinfo',
      format: 'json',
    });
    return res.ok;
  } catch {
    return false;
  }
}

function diagnostics(input: Partial<WikipediaDiagnostics>): WikipediaDiagnostics {
  return {
    queriesTried: input.queriesTried ?? [],
    matchedTitle: input.matchedTitle ?? null,
    infobox: input.infobox ?? 'no-article',
    specFieldCount: input.specFieldCount ?? 0,
    failureReason: input.failureReason,
    llmAttempted: input.llmAttempted ?? false,
    extractionMethod: input.extractionMethod ?? 'none',
  };
}

function parseInfoboxDeterministically(infoboxWikitext: string): CatalogSpecProjectionInput {
  const fields = parseInfoboxFields(infoboxWikitext);
  const input: CatalogSpecProjectionInput = {
    display: parseDisplayField(pickField(fields, ['display', 'screen'])),
    chipset: cleanFieldValue(pickField(fields, ['soc', 'chipset', 'cpu'])),
    ramGb: parseLargestGb(pickField(fields, ['memory', 'ram'])),
    storageOptionsGb: parseStorageOptionsGb(pickField(fields, ['storage', 'internal_memory'])),
    rearCameras: parseRearCameras(pickField(fields, ['rear_camera', 'camera'])),
    frontCamera: parseFrontCamera(pickField(fields, ['front_camera', 'selfie_camera'])),
    batteryMah: parseBatteryMah(pickField(fields, ['battery'])),
    charging: parseCharging(pickField(fields, ['charging'])),
    weightG: parseWeightG(pickField(fields, ['weight'])),
    os: cleanFieldValue(pickField(fields, ['os', 'operating_system'])),
    connectivity: parseConnectivity(pickField(fields, ['connectivity', 'networks'])),
    ipRating: parseIpRating(pickField(fields, ['water_resist', 'water_resistance'])),
    foldable: /fold/i.test(cleanFieldValue(pickField(fields, ['form', 'type'])) ?? ''),
  };

  if (findMissingCoreFields(input).length > 0) return input;
  return input;
}

function parseInfoboxFields(infoboxWikitext: string): Map<string, string> {
  const fields = new Map<string, string>();
  let currentKey: string | null = null;
  let currentValue: string[] = [];

  for (const rawLine of infoboxWikitext.split(/\r?\n/)) {
    const fieldMatch = rawLine.match(/^\s*\|\s*([^=]+?)\s*=\s*(.*)$/);
    if (fieldMatch) {
      if (currentKey) fields.set(currentKey, currentValue.join('\n'));
      currentKey = normalizeInfoboxKey(fieldMatch[1] ?? '');
      currentValue = [fieldMatch[2] ?? ''];
      continue;
    }
    if (currentKey) currentValue.push(rawLine);
  }
  if (currentKey) fields.set(currentKey, currentValue.join('\n'));
  return fields;
}

function normalizeInfoboxKey(value: string): string {
  return normalizeIdentityText(value).replace(/\s+/g, '_');
}

function pickField(fields: Map<string, string>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = fields.get(key);
    if (value) return value;
  }
  return undefined;
}

function cleanFieldValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, ' ')
    .replace(/<ref\b[^/]*\/>/gi, ' ')
    .replace(/\{\{(?:nowrap|ubl|flatlist|plainlist|unbulleted list|hlist)\|/gi, '')
    .replace(/\{\{convert\|([^|{}]+)\|([^|{}]+)(?:\|[^{}]*)?\}\}/gi, '$1 $2')
    .replace(/\{\{cvt\|([^|{}]+)\|([^|{}]+)(?:\|[^{}]*)?\}\}/gi, '$1 $2')
    .replace(/\{\{[^{}]*\}\}/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

function parseDisplayField(
  value: string | undefined,
): CatalogSpecProjectionInput['display'] | undefined {
  const cleaned = cleanFieldValue(value);
  if (!cleaned) return undefined;
  const size = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|")\b/i);
  const resolution = cleaned.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  const refresh = cleaned.match(/(\d{2,3})\s*hz\b/i);
  const panel = cleaned.match(/\b(LTPO\s+OLED|Super Retina XDR OLED|AMOLED|OLED|LCD|IPS)\b/i);
  return {
    size_in: size ? Number(size[1]) : undefined,
    resolution: resolution ? `${resolution[1]}x${resolution[2]}` : undefined,
    refresh_rate_hz: refresh ? Number(refresh[1]) : undefined,
    panel_type: panel?.[1],
  };
}

function parseLargestGb(value: string | undefined): number | undefined {
  const values = parseGbValues(value);
  if (values.length === 0) return undefined;
  return Math.max(...values);
}

function parseStorageOptionsGb(value: string | undefined): number[] | undefined {
  const values = [...new Set(parseGbValues(value))].sort((a, b) => a - b);
  return values.length > 0 ? values : undefined;
}

function parseGbValues(value: string | undefined): number[] {
  const cleaned = cleanFieldValue(value);
  if (!cleaned) return [];
  const values: number[] = [];
  for (const match of cleaned.matchAll(/(\d+(?:\.\d+)?)\s*(TB|GB)\b/gi)) {
    const numeric = Number(match[1]);
    if (!Number.isFinite(numeric)) continue;
    values.push(
      match[2]?.toLowerCase() === 'tb' ? Math.round(numeric * 1024) : Math.round(numeric),
    );
  }
  return values;
}

function parseRearCameras(value: string | undefined): PhoneSpec['rear_cameras'] | undefined {
  const cleaned = cleanFieldValue(value);
  const mp = parseMegapixels(cleaned);
  if (!mp) return undefined;
  return [
    {
      type: 'main',
      mp,
      ois: /\bOIS\b/i.test(cleaned ?? '') || /optical image/i.test(cleaned ?? ''),
    },
  ];
}

function parseFrontCamera(value: string | undefined): PhoneSpec['front_camera'] | undefined {
  const mp = parseMegapixels(cleanFieldValue(value));
  return mp ? { mp } : undefined;
}

function parseMegapixels(value: string | undefined): number | undefined {
  const match = value?.match(/(\d+(?:\.\d+)?)\s*(?:MP|megapixel)/i);
  if (!match) return undefined;
  const mp = Number(match[1]);
  return Number.isFinite(mp) && mp > 0 ? mp : undefined;
}

function parseBatteryMah(value: string | undefined): number | undefined {
  const cleaned = cleanFieldValue(value);
  const match = cleaned?.match(/(\d{3,5})\s*mAh\b/i);
  if (!match) return undefined;
  const mah = Number(match[1]);
  return Number.isFinite(mah) && mah > 0 ? mah : undefined;
}

function parseCharging(value: string | undefined): PhoneSpec['charging'] {
  const cleaned = cleanFieldValue(value);
  const watts = cleaned?.match(/(\d{1,3})\s*W\b/i);
  return { wired_w: watts ? Number(watts[1]) : undefined };
}

function parseWeightG(value: string | undefined): number | undefined {
  const cleaned = cleanFieldValue(value);
  const grams = cleaned?.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (!grams) return undefined;
  const weight = Number(grams[1]);
  return Number.isFinite(weight) && weight > 0 ? weight : undefined;
}

function parseConnectivity(value: string | undefined): PhoneSpec['connectivity'] {
  const cleaned = cleanFieldValue(value);
  return {
    wifi: cleaned?.match(/\bWi-?Fi\s*\d(?:E|\.?\d)?/i)?.[0],
    bluetooth: cleaned?.match(/\bBluetooth\s*([\d.]+)/i)?.[1],
    nfc: cleaned ? /\bNFC\b/i.test(cleaned) : undefined,
    usb: cleaned?.match(/\bUSB(?:-C| Type-C| [\d.]+)?/i)?.[0],
  };
}

function parseIpRating(value: string | undefined): string | undefined {
  return cleanFieldValue(value)
    ?.match(/\bIP\d{2}\b/i)?.[0]
    .toUpperCase();
}

function stripBrandPrefix(model: string, brand: string): string {
  const normalizedBrand = normalizeIdentityText(brand);
  const normalizedModel = normalizeIdentityText(model);
  if (!normalizedBrand || !normalizedModel.startsWith(`${normalizedBrand} `)) return model.trim();
  return model.replace(new RegExp(`^${escapeRegExp(brand)}\\s+`, 'i'), '').trim();
}

function modelStartsWithBrand(model: string, brand: string): boolean {
  const normalizedBrand = normalizeIdentityText(brand);
  return Boolean(normalizedBrand && normalizeIdentityText(model).startsWith(`${normalizedBrand} `));
}

function hasBrandOrPhoneFamily(titleTokens: readonly string[], brand: string): boolean {
  const brandTokens = tokenizeTitle(brand);
  if (brandTokens.some((token) => titleTokens.includes(token))) return true;
  return titleTokens.some((token) => PHONE_FAMILY_TOKENS.has(token));
}

function tokenizeTitle(value: string): string[] {
  return normalizeIdentityText(value)
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
}

function numericTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => /^\d+$/.test(token));
}

function hasConflictingGeneration(
  modelNumericTokens: readonly string[],
  titleNumericTokens: readonly string[],
): boolean {
  if (modelNumericTokens.length === 0 || titleNumericTokens.length === 0) return false;
  return titleNumericTokens.some((token) => !modelNumericTokens.includes(token));
}

function isIgnoredSearchToken(token: string): boolean {
  return ['phone', 'smartphone', 'mobile'].includes(token);
}

function isGenericShortModel(modelWordTokens: readonly string[]): boolean {
  const meaningful = modelWordTokens.filter(
    (token) => !GENERIC_MODEL_TOKENS.has(token) && !PHONE_FAMILY_TOKENS.has(token),
  );
  return meaningful.length <= 1;
}

const PHONE_FAMILY_TOKENS = new Set([
  'iphone',
  'galaxy',
  'pixel',
  'oneplus',
  'redmi',
  'poco',
  'moto',
  'xperia',
  'nothing',
  'cmf',
]);

const GENERIC_MODEL_TOKENS = new Set([
  'pro',
  'max',
  'plus',
  'ultra',
  'mini',
  'edge',
  'fold',
  'note',
  'air',
  'lite',
  'power',
]);

function stripParenthetical(value: string): string {
  return value.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

function dedupeNonEmpty(value: string, index: number, values: readonly string[]): boolean {
  const normalized = normalizeIdentityText(value);
  if (!normalized) return false;
  return values.findIndex((item) => normalizeIdentityText(item) === normalized) === index;
}

function countSpecFields(spec: PhoneSpec): number {
  return Object.values(spec).filter((value) => {
    if (value == null) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  }).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

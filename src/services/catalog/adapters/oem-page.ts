/**
 * Generic OEM product-page extractor.
 *
 * Purpose: turn official manufacturer product pages into no-LLM catalog
 * promotion claims. The extractor prefers JSON-LD and metadata, then uses
 * conservative regexes over visible page text for spec fields.
 *
 * Used by: `scripts/catalog-enrich-oem.ts` and fixture tests.
 */
import { parseHTML } from 'linkedom';

import type { CatalogImportRecord } from '../import-schema';
import { canonicalizeUrl } from '../identity';

export interface OemPageExtractionInput {
  readonly url: string;
  readonly html: string;
  readonly fallbackBrand?: string | null;
  readonly fallbackModel?: string | null;
}

export interface FetchOemPageOptions {
  readonly url: string;
  readonly fetchImpl?: typeof fetch;
}

export async function fetchOemPageHtml(options: FetchOemPageOptions): Promise<string> {
  const fetcher = options.fetchImpl ?? fetch;
  const response = await fetcher(options.url, {
    headers: {
      accept: 'text/html,application/xhtml+xml',
      'user-agent': 'RECSYBot/0.1 (https://github.com/rohang1411/RECSY; OEM catalog enrichment)',
    },
  });
  if (!response.ok) {
    throw new Error(`OEM page fetch failed: HTTP ${response.status} ${options.url}`);
  }
  return response.text();
}

export function extractOemProductPage(input: OemPageExtractionInput): CatalogImportRecord {
  const { document } = parseHTML(input.html);
  const jsonLd = readJsonLdObjects(document);
  const product = findProductJsonLd(jsonLd);
  const meta = readMeta(document);
  const text = normalizeWhitespace(document.body?.textContent ?? document.textContent ?? '');

  const name =
    stringValue(product?.name) ??
    meta['og:title'] ??
    meta['twitter:title'] ??
    document.querySelector('h1')?.textContent?.trim() ??
    input.fallbackModel ??
    'Unknown phone';
  const brand =
    readBrand(product) ?? input.fallbackBrand ?? inferBrandFromHost(input.url) ?? 'Unknown';
  const model = stripLeadingBrand(cleanTitle(name), brand);
  const canonicalUrl = canonicalizeUrl(input.url);
  const description =
    stringValue(product?.description) ?? meta.description ?? meta['og:description'];
  const combinedText = [name, description, text].filter(Boolean).join(' ');
  const imageUrl = absoluteUrl(firstString(product?.image) ?? meta['og:image'], input.url);
  const offer = firstObject(product?.offers);
  const msrpUsd = parseOfferUsd(offer);
  const releaseDate = parseReleaseDate(
    stringValue(product?.releaseDate) ?? stringValue(product?.datePublished) ?? combinedText,
  );
  const storageOptions = parseStorageOptions(combinedText);
  const colors = parseColors(combinedText);

  return {
    sourceKey: 'oem_page',
    sourceType: 'oem_page',
    sourceTier: 'T0',
    externalId: canonicalUrl,
    sourceUrl: canonicalUrl,
    brand,
    model,
    tagline: description,
    launchDate: releaseDate,
    releasedAt: releaseDate,
    status: 'active',
    regionAvailability: [],
    msrpUsd,
    imageUrl,
    officialUrl: canonicalUrl,
    aliases: [...new Set([name, `${brand} ${model}`].filter(Boolean))],
    identities: [
      {
        sourceKey: 'official',
        externalId: canonicalUrl,
        identityType: 'official_url',
        url: canonicalUrl,
        confidence: 0.98,
      },
    ],
    configurations: buildConfigurations(storageOptions, colors, canonicalUrl),
    spec: {
      display: parseDisplay(combinedText),
      chipset: parseChipset(combinedText),
      ramGb: parseRam(combinedText),
      storageOptionsGb: storageOptions,
      rearCameras: parseRearCameras(combinedText),
      frontCamera: parseFrontCamera(combinedText),
      batteryMah: parseMah(combinedText),
      charging: parseCharging(combinedText),
      weightG: parseWeightG(combinedText),
      os: parseOs(combinedText),
      connectivity: parseConnectivity(combinedText),
      ipRating: parseIpRating(combinedText),
      colors,
      foldable: /fold|flip/i.test(name),
      highlights: [],
    },
    raw: {
      extractor: 'generic-oem-page-v1',
      url: canonicalUrl,
      jsonLd,
      meta,
    },
  };
}

function readJsonLdObjects(document: Document): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')]) {
    const text = script.textContent?.trim();
    if (!text) continue;
    try {
      collectObjects(JSON.parse(text), out);
    } catch {
      // Ignore malformed third-party JSON-LD; validation will decide quality.
    }
  }
  return out;
}

function collectObjects(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out);
    return;
  }
  if (!isRecord(value)) return;
  out.push(value);
  const graph = value['@graph'];
  if (Array.isArray(graph)) {
    for (const item of graph) collectObjects(item, out);
  }
}

function findProductJsonLd(
  objects: readonly Record<string, unknown>[],
): Record<string, unknown> | null {
  return (
    objects.find((object) => {
      const type = object['@type'];
      return Array.isArray(type)
        ? type.some((item) => stringValue(item)?.toLowerCase() === 'product')
        : stringValue(type)?.toLowerCase() === 'product';
    }) ?? null
  );
}

function readMeta(document: Document): Record<string, string> {
  const out: Record<string, string> = {};
  for (const meta of [...document.querySelectorAll('meta')]) {
    const key =
      meta.getAttribute('property') ?? meta.getAttribute('name') ?? meta.getAttribute('itemprop');
    const content = meta.getAttribute('content');
    if (key && content) out[key.toLowerCase()] = content.trim();
  }
  return out;
}

function readBrand(product: Record<string, unknown> | null): string | undefined {
  if (!product) return undefined;
  const brand = product.brand;
  if (isRecord(brand)) return stringValue(brand.name);
  return stringValue(brand);
}

function parseDisplay(value: string): CatalogImportRecord['spec']['display'] {
  const size = value.match(/(\d+(?:\.\d+)?)\s*(?:["”]|inch|inches|in\b)/i);
  const resolution = value.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  const refresh = value.match(/(\d{2,3})\s*hz/i);
  return {
    size_in: size ? Number(size[1]) : undefined,
    resolution: resolution ? `${resolution[1]}x${resolution[2]}` : undefined,
    refresh_rate_hz: refresh ? Number.parseInt(refresh[1]!, 10) : undefined,
    panel_type: parsePanelType(value),
  };
}

function parsePanelType(value: string): string | undefined {
  return value.match(
    /(ltpo\s+oled|dynamic\s+amoled|amoled|oled|p-oled|ips\s+lcd|lcd|retina)/i,
  )?.[1];
}

function parseChipset(value: string): string | undefined {
  const labeled = value.match(/(?:chipset|processor|platform|soc)\s*:?\s*([^.;\n]+)/i)?.[1]?.trim();
  if (labeled && !isMemoryOrStorageToken(labeled)) return trimSpecValue(labeled);
  return value
    .split(/[.;|]/)
    .map((part) => part.trim())
    .find((part) =>
      /\b(?:snapdragon|dimensity|helio|exynos|tensor|bionic|apple\s+a\d+|kirin|unisoc|tiger)\b/i.test(
        part,
      ),
    );
}

function parseRam(value: string): number | undefined {
  return numberFromMatch(value.match(/(\d+)\s*gb\s*ram/i) ?? value.match(/ram\s*:?\s*(\d+)\s*gb/i));
}

function parseStorageOptions(value: string): number[] {
  const out = new Set<number>();
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb)/gi)) {
    const nextToken = value.slice(
      match.index + match[0].length,
      match.index + match[0].length + 12,
    );
    if (/^\s*ram\b/i.test(nextToken)) continue;
    const amount = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    const gb = unit === 'tb' ? amount * 1024 : amount;
    if (gb >= 16) out.add(gb);
  }
  return [...out].filter(Number.isInteger).sort((a, b) => a - b);
}

function parseRearCameras(value: string): CatalogImportRecord['spec']['rearCameras'] {
  const rearSection =
    value.match(/(?:rear|main)\s+camera(?:s)?\s*:?\s*([^]{0,260})/i)?.[1] ??
    value.match(/camera(?:s)?\s*:?\s*([^]{0,220})/i)?.[1] ??
    value;
  const matches = [...rearSection.matchAll(/(\d+(?:\.\d+)?)\s*mp/gi)].slice(0, 5);
  if (matches.length === 0) return undefined;
  return matches.map((match, index) => ({
    type: cameraTypeForIndex(index),
    mp: Number(match[1]),
  }));
}

function parseFrontCamera(value: string): CatalogImportRecord['spec']['frontCamera'] {
  const section = value.match(/(?:front|selfie)\s+camera\s*:?\s*([^.;\n]+)/i)?.[1];
  const match = section?.match(/(\d+(?:\.\d+)?)\s*mp/i);
  return match ? { mp: Number(match[1]) } : undefined;
}

function parseMah(value: string): number | undefined {
  return numberFromMatch(value.match(/(\d{3,5})\s*mah/i));
}

function parseCharging(value: string): CatalogImportRecord['spec']['charging'] {
  const wired =
    value.match(/(\d{1,3})\s*w\s*(?:wired|charging|adapter)/i) ??
    value.match(/(?:wired|charging)[^\d]{0,30}(\d{1,3})\s*w/i);
  const wireless =
    value.match(/(\d{1,3})\s*w\s*wireless/i) ?? value.match(/wireless[^\d]{0,30}(\d{1,3})\s*w/i);
  const mentionsCharging = /charging|adapter|\bw\b/i.test(value);
  return {
    wired_w: wired ? Number.parseInt(wired[1]!, 10) : undefined,
    wireless_w: wireless ? Number.parseInt(wireless[1]!, 10) : mentionsCharging ? 0 : undefined,
  };
}

function parseWeightG(value: string): number | undefined {
  // Require a plausible weight value (80–399 g). The tighter range and negative
  // lookahead for 'b' (GB) and 'hz' prevent false matches on '5G', '128GB',
  // '60hz', etc. The full plausibility range check in validatePlausibility
  // (80–350 g) serves as a second guard, but catching it here avoids writing
  // a misleading weight into the spec at all.
  const match = value.match(
    /\b([89][0-9]|[1-2][0-9]{2}|3[0-4][0-9]|35[0-9])(?:\.[0-9]+)?\s*g\b(?!b|hz|pixel)/i,
  );
  return match?.[1] ? Number(match[1]) : undefined;
}

function parseOs(value: string): string | undefined {
  return value
    .match(/(?:android|ios|nothing os|one ui|hyperos|coloros|oxygenos)[^.;,\n]{0,40}/i)?.[0]
    ?.trim();
}

function parseConnectivity(value: string): CatalogImportRecord['spec']['connectivity'] {
  return {
    wifi: value.match(/wi-?fi\s*(?:\d|[a-z]|802\.11)[\w .-]*/i)?.[0]?.trim(),
    bluetooth: value.match(/bluetooth\s*([\d.]+)/i)?.[1],
    nfc: hasNfc(value),
    usb: value.match(/usb(?:\s*type-?c|-c|[\w .-]*)/i)?.[0]?.trim(),
  };
}

function parseIpRating(value: string): string | undefined {
  return value.match(/IP\d{2}/i)?.[0]?.toUpperCase();
}

function parseColors(value: string): string[] {
  const section = value.match(/colou?rs?\s*:?\s*([^.;\n]+)/i)?.[1];
  if (!section) return [];
  return section
    .split(/[,/|]/)
    .map((part) => part.trim())
    .filter((part) => /^[A-Za-z][A-Za-z -]{1,30}$/.test(part))
    .slice(0, 12);
}

function parseOfferUsd(offer: Record<string, unknown> | null): string | undefined {
  if (!offer) return undefined;
  const currency = stringValue(offer.priceCurrency);
  const price = stringValue(offer.price);
  if (!price || (currency && currency.toUpperCase() !== 'USD')) return undefined;
  const parsed = Number(price.replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed.toFixed(2) : undefined;
}

function parseReleaseDate(value: string): string | undefined {
  const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  return undefined;
}

function buildConfigurations(
  storageOptions: readonly number[],
  colors: readonly string[],
  sourceUrl: string,
): CatalogImportRecord['configurations'] {
  if (storageOptions.length === 0 && colors.length === 0) return [];
  const configs: CatalogImportRecord['configurations'] = [];
  for (const storageGb of storageOptions.length > 0 ? storageOptions : [undefined]) {
    for (const color of colors.length > 0 ? colors : [undefined]) {
      configs.push({ storageGb, color, sourceKey: 'oem_page', sourceUrl, confidence: 0.9 });
    }
  }
  return configs;
}

function firstObject(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value.find(isRecord) ?? null;
  return isRecord(value) ? value : null;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) return value.map(stringValue).find(Boolean);
  return stringValue(value);
}

function absoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, base).toString();
  } catch {
    return undefined;
  }
}

function inferBrandFromHost(url: string): string | undefined {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  const firstPart = host.split('.')[0];
  return firstPart ? firstPart[0]!.toUpperCase() + firstPart.slice(1) : undefined;
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s+\|.+$/, '')
    .replace(/\s+-\s+.+$/, '')
    .trim();
}

function stripLeadingBrand(name: string, brand: string): string {
  return name.replace(new RegExp(`^${escapeRegExp(brand)}\\s+`, 'i'), '').trim();
}

function trimSpecValue(value: string): string {
  return value
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+(processor|chipset|mobile platform)$/i, '')
    .trim();
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasNfc(value: string): boolean | undefined {
  if (/\b(?:no|without)\s+nfc\b/i.test(value)) return false;
  return /\bnfc\b/i.test(value) ? true : undefined;
}

function cameraTypeForIndex(
  index: number,
): 'main' | 'ultrawide' | 'telephoto' | 'periscope' | 'macro' {
  return index === 0 ? 'main' : index === 1 ? 'ultrawide' : index === 2 ? 'telephoto' : 'macro';
}

function numberFromMatch(match: RegExpMatchArray | null | undefined): number | undefined {
  return match?.[1] ? Number(match[1]) : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isMemoryOrStorageToken(value: string): boolean {
  return /\b\d+\s*(?:gb|tb)\b/i.test(value) || /\bram|storage|rom|ufs|nvme\b/i.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

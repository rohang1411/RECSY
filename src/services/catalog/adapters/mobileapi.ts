/**
 * MobileAPI.dev catalog adapter.
 *
 * Purpose: optional licensed structured source for recent phone discovery and
 * enrichment. This adapter makes no LLM calls; it only maps API fields into
 * the catalog promotion contract and lets normal validation decide whether a
 * record is complete enough to promote.
 *
 * Used by: `scripts/catalog-sync-mobileapi.ts`.
 */
import { z } from 'zod';

import type { CatalogImportRecord } from '../import-schema';

const BASE_URL = 'https://api.mobileapi.dev';

const MobileApiDeviceSchema = z.record(z.string(), z.unknown());

const MobileApiByYearResponseSchema = z
  .object({
    total: z.number().optional(),
    page: z.number(),
    page_size: z.number().optional(),
    total_pages: z.number().optional(),
    has_next: z.boolean().optional(),
    devices: z.array(MobileApiDeviceSchema),
  })
  .passthrough();

export interface MobileApiByYearOptions {
  readonly apiKey: string;
  readonly year: number;
  readonly page?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface MobileApiByYearPage {
  readonly page: number;
  readonly totalPages: number | null;
  readonly hasNext: boolean;
  readonly devices: readonly Record<string, unknown>[];
}

export async function fetchMobileApiDevicesByYear(
  options: MobileApiByYearOptions,
): Promise<MobileApiByYearPage> {
  const fetcher = options.fetchImpl ?? fetch;
  const page = options.page ?? 1;
  const url = new URL('/devices/by-year/', BASE_URL);
  url.searchParams.set('year', String(options.year));
  url.searchParams.set('page', String(page));

  const response = await fetcher(url, {
    headers: {
      accept: 'application/json',
      authorization: `Token ${options.apiKey}`,
      'user-agent': 'RECSYBot/0.1 (https://github.com/rohang1411/RECSY; catalog sync)',
    },
  });
  if (!response.ok) {
    throw new Error(`MobileAPI by-year failed: HTTP ${response.status}`);
  }

  const parsed = MobileApiByYearResponseSchema.parse(await response.json());
  return {
    page: parsed.page,
    totalPages: parsed.total_pages ?? null,
    hasNext:
      parsed.has_next ??
      (parsed.total_pages != null ? parsed.page < parsed.total_pages : parsed.devices.length > 0),
    devices: parsed.devices,
  };
}

export function mobileApiDeviceToImportRecord(
  device: Record<string, unknown>,
): CatalogImportRecord {
  const id = stringValue(device.id) ?? stringValue(device.slug) ?? stringValue(device.name);
  const name = stringValue(device.name) ?? stringValue(device.model) ?? 'Unknown phone';
  const brand = readBrand(device);
  const description = stringValue(device.description);
  const releaseDate = parseReleaseDate(
    joinedText(device.release_date, device.releaseDate, description),
  );
  const storageOptions = parseStorageOptions(
    joinedText(device.storage, device.memory, device.hardware, description),
  );
  const colors = splitList(stringValue(device.colors));
  const rearCameras = parseCameraList(
    joinedText(device.camera, device.main_camera, device.mainCamera, device.rear_camera),
  );
  const frontCamera = parseFrontCamera(
    joinedText(device.front_camera, device.selfie_camera, device.selfieCamera),
  );
  const display = parseDisplay(
    joinedText(device.screen_resolution, device.display, device.screen, description),
  );
  const connectivity = parseConnectivity(device);
  const charging = parseCharging(device);

  return {
    sourceKey: 'mobileapi',
    sourceType: 'licensed_api',
    sourceTier: 'T2',
    externalId: id,
    sourceUrl: id ? `${BASE_URL}/devices/${id}/` : undefined,
    brand,
    model: stripLeadingBrand(name, brand),
    tagline: description,
    launchDate: releaseDate,
    releasedAt: releaseDate,
    status: 'active',
    regionAvailability: [],
    msrpUsd: parsePriceUsd(device),
    imageUrl: stringValue(device.image_url) ?? stringValue(device.main_image_url),
    aliases: [name],
    identities: id
      ? [
          {
            sourceKey: 'mobileapi',
            externalId: id,
            identityType: 'provider_id',
            confidence: 0.95,
          },
        ]
      : [],
    configurations: buildConfigurations(storageOptions, colors),
    spec: {
      display,
      chipset: parseChipset(joinedText(device.hardware, device.chipset, description)),
      ramGb: parseRam(joinedText(device.hardware, device.ram, device.memory, description)),
      storageOptionsGb: storageOptions,
      rearCameras,
      frontCamera,
      batteryMah: parseMah(joinedText(device.battery_capacity, device.battery, description)),
      charging,
      weightG: parseWeightG(stringValue(device.weight)),
      os: stringValue(device.os) ?? stringValue(device.platform) ?? stringValue(device.software),
      connectivity,
      ipRating: parseIpRating(device),
      colors,
      foldable: /fold|flip/i.test(name),
      highlights: [],
    },
    raw: device,
  };
}

function readBrand(device: Record<string, unknown>): string {
  const brandObject = device.brand;
  if (brandObject && typeof brandObject === 'object' && !Array.isArray(brandObject)) {
    const name = stringValue((brandObject as Record<string, unknown>).name);
    if (name) return name;
  }
  return (
    stringValue(device.brand_name) ??
    stringValue(device.manufacturer_name) ??
    stringValue(device.manufacturer) ??
    'Unknown'
  );
}

function stripLeadingBrand(name: string, brand: string): string {
  const pattern = new RegExp(`^${escapeRegExp(brand)}\\s+`, 'i');
  return name.replace(pattern, '').trim();
}

function parseDisplay(value: string | undefined): CatalogImportRecord['spec']['display'] {
  if (!value) return undefined;
  const size = value.match(/(\d+(?:\.\d+)?)\s*(?:"|inch|in\b)/i);
  const resolution = value.match(/(\d{3,4})\s*x\s*(\d{3,4})/i);
  const refresh = value.match(/(\d{2,3})\s*hz/i);
  return {
    size_in: size ? Number(size[1]) : undefined,
    resolution: resolution ? `${resolution[1]}x${resolution[2]}` : undefined,
    refresh_rate_hz: refresh ? Number.parseInt(refresh[1]!, 10) : undefined,
    panel_type: parsePanelType(value),
  };
}

function parsePanelType(value: string): string | undefined {
  const match = value.match(/(ltpo\s+oled|amoled|oled|ips\s+lcd|lcd|retina|p-oled)/i);
  return match?.[1];
}

function parseChipset(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const explicit = value.match(/(?:chipset|soc)\s*:?\s*([^,.;]+)/i)?.[1]?.trim();
  if (explicit && !isMemoryOrStorageToken(explicit)) return explicit;
  const beforeChipset = value.match(/([^,.;]+?)\s+(?:chipset|soc)\b/i)?.[1]?.trim();
  if (beforeChipset && !isMemoryOrStorageToken(beforeChipset)) return beforeChipset;
  for (const part of value.split(/[,;|]/).map((item) => item.trim())) {
    if (!part || isMemoryOrStorageToken(part)) continue;
    if (
      /\b(?:snapdragon|dimensity|helio|exynos|tensor|bionic|apple\s+a\d+|kirin|unisoc|tiger)\b/i.test(
        part,
      )
    ) {
      return part;
    }
  }
  const firstUsefulPart = value
    .split(/[,;|]/)
    .map((item) => item.trim())
    .find((part) => part && !isMemoryOrStorageToken(part) && !/display|battery|camera/i.test(part));
  return firstUsefulPart;
}

function parseRam(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d+)\s*gb\s*ram/i) ?? value.match(/ram\s*:?\s*(\d+)\s*gb/i);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function parseStorageOptions(value: string | undefined): number[] {
  if (!value) return [];
  const out = new Set<number>();
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(tb|gb)/gi)) {
    const nextToken = value.slice(
      match.index + match[0].length,
      match.index + match[0].length + 12,
    );
    if (/^\s*ram\b/i.test(nextToken)) continue;
    const amount = Number(match[1]);
    const unit = match[2]!.toLowerCase();
    out.add(unit === 'tb' ? amount * 1024 : amount);
  }
  return [...out].filter(Number.isInteger).sort((a, b) => a - b);
}

function parseCameraList(value: string | undefined): CatalogImportRecord['spec']['rearCameras'] {
  if (!value) return undefined;
  const matches = [...value.matchAll(/(\d+(?:\.\d+)?)\s*mp/gi)];
  if (matches.length === 0) return undefined;
  return matches.slice(0, 5).map((match, index) => ({
    type: index === 0 ? ('main' as const) : ('ultrawide' as const),
    mp: Number(match[1]),
  }));
}

function parseFrontCamera(value: string | undefined): CatalogImportRecord['spec']['frontCamera'] {
  if (!value) return undefined;
  const match = value.match(/(\d+(?:\.\d+)?)\s*mp/i);
  return match ? { mp: Number(match[1]) } : undefined;
}

function parseMah(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d{3,5})\s*mah/i) ?? value.match(/(\d{3,5})/);
  return match ? Number.parseInt(match[1]!, 10) : undefined;
}

function parseCharging(device: Record<string, unknown>): CatalogImportRecord['spec']['charging'] {
  const value = [device.charging, device.battery, device.battery_charging]
    .map(stringValue)
    .filter(Boolean)
    .join(' ');
  const wired =
    value.match(/(\d{1,3})\s*w\s*wired/i) ??
    value.match(/(\d{1,3})\s*w(?!\s*(?:wireless|reverse))/i);
  const wireless =
    value.match(/(\d{1,3})\s*w\s*wireless/i) ?? value.match(/wireless[^\d]*(\d{1,3})\s*w/i);
  return {
    wired_w: wired ? Number.parseInt(wired[1]!, 10) : undefined,
    wireless_w: wireless ? Number.parseInt(wireless[1]!, 10) : value ? 0 : undefined,
  };
}

function parseWeightG(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/(\d+(?:\.\d+)?)\s*g/i);
  return match ? Number(match[1]) : undefined;
}

function parseConnectivity(
  device: Record<string, unknown>,
): CatalogImportRecord['spec']['connectivity'] {
  const haystack = [device.network, device.connectivity, device.comms]
    .map(stringValue)
    .filter(Boolean)
    .join(' ');
  return {
    wifi: haystack.match(/wi-?fi\s*([\w.]+)/i)?.[0],
    bluetooth: haystack.match(/bluetooth\s*([\d.]+)/i)?.[1],
    nfc: haystack ? hasNfc(haystack) : undefined,
    usb: haystack.match(/usb[-\s\w.]*/i)?.[0]?.trim(),
  };
}

function hasNfc(value: string): boolean {
  if (/\b(?:no|without)\s+nfc\b/i.test(value)) return false;
  return /(?:^|\b)nfc\b/i.test(value);
}

function parseIpRating(device: Record<string, unknown>): string | undefined {
  const value = [device.ip_rating, device.protection, device.body]
    .map(stringValue)
    .filter(Boolean)
    .join(' ');
  return value.match(/IP\d{2}/i)?.[0]?.toUpperCase();
}

function parsePriceUsd(device: Record<string, unknown>): string | undefined {
  const value = stringValue(device.price_usd) ?? stringValue(device.price);
  if (!value) return undefined;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]).toFixed(2) : undefined;
}

function parseReleaseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (iso) return iso;
  const released = value.match(/(\d{4}),?\s+([A-Za-z]+)(?:\s+(\d{1,2}))?/);
  if (!released) return undefined;
  const day = released[3] ?? '01';
  const parsed = new Date(`${released[2]} ${day}, ${released[1]} UTC`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
}

function buildConfigurations(
  storageOptions: readonly number[],
  colors: readonly string[],
): CatalogImportRecord['configurations'] {
  if (storageOptions.length === 0 && colors.length === 0) return [];
  const configs: CatalogImportRecord['configurations'] = [];
  for (const storageGb of storageOptions.length > 0 ? storageOptions : [undefined]) {
    for (const color of colors.length > 0 ? colors : [undefined]) {
      configs.push({ storageGb, color, sourceKey: 'mobileapi', confidence: 0.8 });
    }
  }
  return configs;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function joinedText(...values: readonly unknown[]): string | undefined {
  const parts = values.map(stringValue).filter((value): value is string => Boolean(value));
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function isMemoryOrStorageToken(value: string): boolean {
  return /\b\d+\s*(?:gb|tb)\b/i.test(value) || /\bram|storage|rom|ufs|nvme\b/i.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

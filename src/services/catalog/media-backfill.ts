/**
 * Helpers for safely filling missing phone media from catalog sources.
 *
 * Purpose: keep image backfills conservative. We only accept remote images
 * from high-confidence identity matches and validate that the URL still serves
 * an image before writing it to the catalog.
 */
import { normalizeIdentityText } from './identity';

export interface PhoneMediaBackfillPhone {
  readonly brand: string;
  readonly model: string;
  readonly imageUrl: string | null;
  readonly mediaStatus: 'local_ok' | 'remote_only' | 'missing' | 'blocked' | null;
}

export interface PhoneMediaCandidate {
  readonly sourceKey: string;
  readonly sourceUrl?: string | null;
  readonly externalId?: string | null;
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly title: string;
  readonly imageUrl?: string | null;
  readonly aliases?: readonly string[];
}

export interface SelectedPhoneMediaCandidate {
  readonly imageUrl: string;
  readonly sourceKey: string;
  readonly sourceUrl: string | null;
  readonly externalId: string | null;
  readonly matchReason: string;
}

export interface RemoteImageValidation {
  readonly ok: boolean;
  readonly status?: number;
  readonly contentType?: string | null;
  readonly reason?: string;
}

export function needsPhoneMediaBackfill(phone: PhoneMediaBackfillPhone): boolean {
  return (
    !phone.imageUrl?.trim() ||
    phone.mediaStatus == null ||
    phone.mediaStatus === 'missing' ||
    phone.mediaStatus === 'blocked'
  );
}

export function selectPhoneMediaCandidate(
  phone: PhoneMediaBackfillPhone,
  candidates: readonly PhoneMediaCandidate[],
): SelectedPhoneMediaCandidate | null {
  for (const candidate of candidates) {
    const imageUrl = candidate.imageUrl?.trim();
    if (!imageUrl || !isAllowedCatalogImageUrl(imageUrl)) continue;
    const matchReason = mediaCandidateMatchReason(phone, candidate);
    if (!matchReason) continue;
    return {
      imageUrl,
      sourceKey: candidate.sourceKey,
      sourceUrl: candidate.sourceUrl ?? null,
      externalId: candidate.externalId ?? null,
      matchReason,
    };
  }
  return null;
}

export function mediaCandidateMatchReason(
  phone: PhoneMediaBackfillPhone,
  candidate: PhoneMediaCandidate,
): string | null {
  const phoneBrand = normalizeIdentityText(phone.brand);
  const candidateBrandValue = candidate.brand ?? inferBrandFromTitle(candidate.title);
  if (!candidateBrandValue) return null;
  const candidateBrand = normalizeIdentityText(candidateBrandValue);
  if (!candidateBrand || candidateBrand !== phoneBrand) return null;

  const phoneModel = normalizedModel(phone.model, phone.brand);
  const candidateModels = [candidate.model, candidate.title, ...(candidate.aliases ?? [])]
    .map((value) => (value ? normalizedModel(value, phone.brand) : null))
    .filter((value): value is string => Boolean(value));

  if (candidateModels.includes(phoneModel)) return 'brand_and_exact_model';
  return null;
}

export function isAllowedCatalogImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !BLOCKED_IMAGE_HOST_RE.test(url.hostname);
  } catch {
    return false;
  }
}

export async function validateRemoteImageUrl(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteImageValidation> {
  if (!isAllowedCatalogImageUrl(url)) {
    return { ok: false, reason: 'unsupported_image_url' };
  }

  const head = await fetchImpl(url, {
    method: 'HEAD',
    headers: { 'user-agent': USER_AGENT },
  });
  if (isImageResponse(head)) {
    return {
      ok: true,
      status: head.status,
      contentType: head.headers.get('content-type'),
    };
  }

  if (![403, 405, 406].includes(head.status)) {
    return {
      ok: false,
      status: head.status,
      contentType: head.headers.get('content-type'),
      reason: `head_http_${head.status}`,
    };
  }

  const get = await fetchImpl(url, {
    method: 'GET',
    headers: {
      range: 'bytes=0-2047',
      'user-agent': USER_AGENT,
    },
  });
  return {
    ok: isImageResponse(get),
    status: get.status,
    contentType: get.headers.get('content-type'),
    reason: isImageResponse(get) ? undefined : `get_http_${get.status}`,
  };
}

function normalizedModel(value: string, brand: string): string {
  return normalizeIdentityText(value)
    .replace(new RegExp(`^${escapeRegExp(normalizeIdentityText(brand))}\\s+`, 'i'), '')
    .trim();
}

function inferBrandFromTitle(title: string): string | null {
  const normalized = normalizeIdentityText(title);
  for (const [prefix, brand] of TITLE_BRANDS) {
    if (normalized === prefix || normalized.startsWith(`${prefix} `)) return brand;
  }
  return null;
}

function isImageResponse(response: Response): boolean {
  if (!response.ok && response.status !== 206) return false;
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  return contentType.startsWith('image/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const USER_AGENT = 'RECSYBot/0.1 (https://github.com/rohang1411/RECSY; catalog media backfill)';

const BLOCKED_IMAGE_HOST_RE =
  /(?:^|\.)example\.com$|(?:^|\.)localhost$|(?:^|\.)127\.0\.0\.1$|(?:^|\.)0\.0\.0\.0$/i;

const TITLE_BRANDS: readonly (readonly [string, string])[] = [
  ['iphone', 'Apple'],
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
];

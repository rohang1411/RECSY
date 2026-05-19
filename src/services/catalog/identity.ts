/**
 * Catalog identity helpers.
 *
 * Purpose: normalize phone names into conservative keys for matching and
 * staging. These helpers intentionally prefer false negatives over false
 * merges; exact external identities still outrank canonical keys.
 *
 * Used by: catalog refresh scripts, legacy backfill, matcher tests.
 */

export interface CanonicalKeyInput {
  readonly brand: string;
  readonly model: string;
  readonly launchDate?: Date | string | null;
}

const TRADEMARK_RE = /(?:\b(?:tm|sm|registered)\b|[\u2122\u00ae\u2120])/gi;
const STORAGE_RE = /\b(?:\d+\s?(?:gb|tb)|\d+\s?\/\s?\d+\s?(?:gb|tb)?)\b/gi;
const CONFIG_TOKEN_RE =
  /\b(?:unlocked|dual\s*sim|single\s*sim|esim|carrier|verizon|att|at&t|t-mobile|sprint|global|international)\b/gi;

export function normalizeIdentityText(value: string): string {
  return value
    .replace(/[\u2122\u00ae\u2120]/g, '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(TRADEMARK_RE, '')
    .replace(/&/g, ' and ')
    .replace(/[()]/g, ' ')
    .replace(/\+/g, ' plus ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

export function stripConfigurationTokens(model: string): string {
  return normalizeIdentityText(model)
    .replace(STORAGE_RE, ' ')
    .replace(CONFIG_TOKEN_RE, ' ')
    .replace(/\b(?:black|white|blue|green|pink|red|yellow|gray|grey|silver|gold|purple)\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugifyCatalogPart(value: string): string {
  return normalizeIdentityText(value).replace(/\s+/g, '-');
}

export function deriveLaunchYear(launchDate?: Date | string | null): string {
  if (!launchDate) return 'unknown';
  const date = typeof launchDate === 'string' ? new Date(launchDate) : launchDate;
  if (Number.isNaN(date.getTime())) return 'unknown';
  return String(date.getUTCFullYear());
}

export function buildCanonicalKey(input: CanonicalKeyInput): string {
  const brand = slugifyCatalogPart(input.brand);
  const model = stripConfigurationTokens(input.model).replace(/\s+/g, '-');
  const year = deriveLaunchYear(input.launchDate);
  return `${brand}:${model}:${year}`;
}

export function buildPhoneSlug(brand: string, model: string): string {
  return `${slugifyCatalogPart(brand)}-${stripConfigurationTokens(model).replace(/\s+/g, '-')}`;
}

export function canonicalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (
      /^utm_/i.test(key) ||
      ['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'ref'].includes(key.toLowerCase())
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== '/' && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  url.searchParams.sort();
  return url.toString();
}

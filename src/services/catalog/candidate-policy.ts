/**
 * Shared candidate selection policy for automated catalog refresh.
 *
 * Purpose: keep discovery/enrichment queues focused on released, phone-like,
 * mainstream devices first so incomplete or unreleased rows do not crowd out
 * useful catalog updates.
 */
import { brandPriorityRank } from './brand-priority';

export interface CatalogPriorityCandidate {
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly title?: string | null;
  readonly launchDate?: string | null;
  readonly releaseDate?: string | null;
  readonly releasedAt?: string | null;
}

export function catalogReleaseTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function catalogCandidateReleaseTimestamp(candidate: CatalogPriorityCandidate): number {
  return (
    catalogReleaseTimestamp(candidate.launchDate) ||
    catalogReleaseTimestamp(candidate.releaseDate) ||
    catalogReleaseTimestamp(candidate.releasedAt)
  );
}

export function isFutureCatalogDate(
  value: string | null | undefined,
  now: Date = new Date(),
): boolean {
  const timestamp = catalogReleaseTimestamp(value);
  if (timestamp === 0) return false;
  return timestamp >= startOfNextUtcDay(now).getTime();
}

export function isReleasedCatalogCandidate(
  candidate: CatalogPriorityCandidate,
  now: Date = new Date(),
): boolean {
  return (
    !isFutureCatalogDate(candidate.launchDate, now) &&
    !isFutureCatalogDate(candidate.releaseDate, now) &&
    !isFutureCatalogDate(candidate.releasedAt, now)
  );
}

export function compareCatalogPriorityThenNewest(
  a: CatalogPriorityCandidate,
  b: CatalogPriorityCandidate,
): number {
  const brandRank = brandPriorityRank(a.brand) - brandPriorityRank(b.brand);
  if (brandRank !== 0) return brandRank;

  const releaseRank = catalogCandidateReleaseTimestamp(b) - catalogCandidateReleaseTimestamp(a);
  if (releaseRank !== 0) return releaseRank;

  return catalogCandidateTitle(a).localeCompare(catalogCandidateTitle(b));
}

export function isLikelyCatalogPhoneTitle(title: string): boolean {
  return !NON_PHONE_TITLE_RE.test(title) && !MULTI_PHONE_TITLE_RE.test(title);
}

export function catalogReleaseRetryAfter(
  value: string | null | undefined,
  now: Date = new Date(),
): Date {
  const timestamp = catalogReleaseTimestamp(value);
  if (timestamp === 0 || timestamp < now.getTime()) {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  return new Date(timestamp + 24 * 60 * 60 * 1000);
}

export function startOfNextUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + 1));
}

function catalogCandidateTitle(candidate: CatalogPriorityCandidate): string {
  return [candidate.brand, candidate.model, candidate.title].filter(Boolean).join(' ');
}

const NON_PHONE_TITLE_RE =
  /\b(?:ipad|tablet|pad|etpad|acepad|iconia|watch|macbook|laptop|chromebook|earbuds|headphones|smart\s+tv)\b/i;

const MULTI_PHONE_TITLE_RE =
  /\b(?:iphone|galaxy|pixel|oneplus|nothing phone|moto|xperia|redmi|poco|oppo|vivo|honor|huawei)\b.{0,80}\s(?:and|&)\s.{0,80}\b(?:iphone|galaxy|pixel|oneplus|nothing phone|moto|xperia|redmi|poco|oppo|vivo|honor|huawei)\b/i;

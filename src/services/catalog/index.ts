/**
 * Catalog service barrel.
 *
 * Purpose: expose the stable public surface for catalog refresh scripts and
 * future catalog promotion code.
 *
 * Used by: scripts/catalog-refresh.ts, scripts/catalog-report.ts, tests.
 */
export {
  buildCanonicalKey,
  buildPhoneSlug,
  canonicalizeUrl,
  deriveLaunchYear,
  normalizeIdentityText,
  slugifyCatalogPart,
  stripConfigurationTokens,
} from './identity';
export { generateAliasCandidates, type AliasCandidate } from './aliases';
export {
  brandPriorityRank,
  DEFAULT_MAINSTREAM_BRAND_PRIORITY,
  isMainstreamPriorityBrand,
  mainstreamPriorityBrandLabel,
} from './brand-priority';
export type { BrandPriorityEntry } from './brand-priority';
export {
  catalogCandidateReleaseTimestamp,
  catalogReleaseRetryAfter,
  catalogReleaseTimestamp,
  compareCatalogPriorityThenNewest,
  isFutureCatalogDate,
  isLikelyCatalogPhoneTitle,
  isReleasedCatalogCandidate,
  isWeakCatalogReleaseDate,
  startOfNextUtcDay,
} from './candidate-policy';
export type { CatalogPriorityCandidate } from './candidate-policy';
export {
  CORE_SPEC_FIELDS,
  findMissingCoreFields,
  phoneSpecToCatalogProjectionInput,
  projectPhoneSpec,
  SPEC_COMPLETENESS_ENRICH_THRESHOLD,
  SPEC_COMPLETENESS_PROMOTE_OK,
  specCompleteness,
} from './spec-project';
export type { CatalogSpecProjectionInput, ProjectionResult } from './spec-project';
export { validateCatalogCandidate, validatePlausibility } from './validation';
export type { CatalogValidationIssue } from './validation';
export { hasOemUrlBuilder, resolveOemUrls } from './oem-url-resolver';
export type { OemUrlCandidate } from './oem-url-resolver';
export { hashJson, sha256Hex, stableCandidateKey } from './snapshots';
export { CatalogImportRecordSchema, parseCatalogImportFile } from './import-schema';
export type { CatalogImportRecord, CatalogPromotionClaims } from './import-schema';
export { buildPromotionPlan, promoteCatalogCandidate } from './promote';
export type { PromoteCandidateResult, PromotionPlan } from './promote';
export type { CatalogDiscoveryCandidate, CatalogSourceTier, WikidataPhoneCandidate } from './types';
export { buildRecentPhonesQuery, discoverRecentWikidataPhones } from './adapters/wikidata';
export { findWikidataPhonesByName, buildPhoneNameQuery } from './adapters/wikidata';
export {
  fetchMobileApiDevicesByYear,
  isMobileApiPhone,
  mobileApiDeviceToImportRecord,
  mobileApiDeviceType,
  parseReleaseDate,
} from './adapters/mobileapi';
export type { MobileApiByYearPage } from './adapters/mobileapi';
export { extractOemProductPage, fetchOemPageHtml } from './adapters/oem-page';
export { fetchWikipediaSpecs, checkWikipediaAvailability } from './adapters/wikipedia';
export type { WikipediaDiagnostics, WikipediaFetchResult } from './adapters/wikipedia';
export {
  needsPhoneMediaBackfill,
  selectPhoneMediaCandidate,
  mediaCandidateMatchReason,
  validateRemoteImageUrl,
} from './media-backfill';

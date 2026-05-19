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
export { projectPhoneSpec, specCompleteness } from './spec-project';
export type { CatalogSpecProjectionInput, ProjectionResult } from './spec-project';
export { validateCatalogCandidate, validatePlausibility } from './validation';
export type { CatalogValidationIssue } from './validation';
export { hashJson, sha256Hex, stableCandidateKey } from './snapshots';
export type { CatalogDiscoveryCandidate, CatalogSourceTier, WikidataPhoneCandidate } from './types';
export { buildRecentPhonesQuery, discoverRecentWikidataPhones } from './adapters/wikidata';

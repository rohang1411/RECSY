/**
 * Catalog service shared types.
 *
 * Purpose: keep catalog adapter/orchestrator data shapes independent from
 * Drizzle row types.
 *
 * Used by: catalog adapters, scripts, and tests.
 */

export type CatalogSourceTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4';

export interface CatalogDiscoveryCandidate {
  readonly sourceKey: string;
  readonly sourceType: string;
  readonly externalId?: string | null;
  readonly sourceUrl?: string | null;
  readonly title: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface WikidataPhoneCandidate extends CatalogDiscoveryCandidate {
  readonly sourceKey: 'wikidata';
  readonly sourceType: 'wikidata';
  readonly externalId: string;
  readonly sourceUrl: string;
  readonly brand?: string | null;
  readonly model?: string | null;
  readonly releaseDate?: string | null;
  readonly officialUrl?: string | null;
  readonly imageUrl?: string | null;
  readonly aliases: readonly string[];
}

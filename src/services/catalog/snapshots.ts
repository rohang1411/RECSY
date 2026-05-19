/**
 * Catalog snapshot helpers.
 *
 * Purpose: derive stable discovery keys and content hashes so monthly catalog
 * refreshes can skip unchanged source pages.
 *
 * Used by: catalog candidates, Wikidata adapter, catalog refresh CLI.
 */
import { createHash } from 'node:crypto';

import { canonicalizeUrl } from './identity';

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableCandidateKey(input: {
  readonly sourceKey: string;
  readonly externalId?: string | null;
  readonly sourceUrl?: string | null;
}): string {
  if (input.externalId && input.externalId.trim().length > 0) {
    return `${input.sourceKey}:${input.externalId.trim()}`;
  }
  if (!input.sourceUrl) {
    throw new Error('stableCandidateKey requires externalId or sourceUrl');
  }
  return `${input.sourceKey}:url:${sha256Hex(canonicalizeUrl(input.sourceUrl))}`;
}

export function hashJson(value: unknown): string {
  return sha256Hex(JSON.stringify(sortJson(value)));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, val]) => [key, sortJson(val)]),
    );
  }
  return value;
}

import { and, eq, inArray, isNotNull, lte, gte, sql, or, isNull, type SQL } from 'drizzle-orm';

import { phones, phoneRegionalDetails } from '@/services/db/schema';

import type { BrowseFilterState } from './search-params';

/**
 * Build Drizzle `where` for active phones and {@link BrowseFilterState}.
 * Foldable is read from `spec_json` JSONB (`PhoneSpecSchema.foldable`).
 */
export function browseWhereFromState(state: BrowseFilterState, regionCode = 'US'): SQL {
  const country = regionCode.toUpperCase();
  const parts: SQL[] = [
    eq(phones.status, 'active'),
    or(isNull(phoneRegionalDetails.countryCode), eq(phoneRegionalDetails.countryCode, country))!,
    // Exclude phones explicitly marked as unavailable in this region
    or(eq(phoneRegionalDetails.isAvailable, true), isNull(phoneRegionalDetails.isAvailable))!,
  ];

  if (state.brands.length > 0) {
    parts.push(inArray(phones.brand, [...state.brands]));
  }

  if (state.minPriceUsd != null) {
    parts.push(isNotNull(phoneRegionalDetails.price));
    parts.push(gte(phoneRegionalDetails.price, String(state.minPriceUsd)));
  }
  if (state.maxPriceUsd != null) {
    parts.push(isNotNull(phoneRegionalDetails.price));
    parts.push(lte(phoneRegionalDetails.price, String(state.maxPriceUsd)));
  }

  if (state.foldable === 'yes') {
    parts.push(sql`coalesce((${phones.specJson})::jsonb->>'foldable', 'false') = 'true'`);
  } else if (state.foldable === 'no') {
    parts.push(sql`coalesce((${phones.specJson})::jsonb->>'foldable', 'false') = 'false'`);
  }

  if (parts.length === 1) {
    return parts[0]!;
  }
  return and(...parts)!;
}

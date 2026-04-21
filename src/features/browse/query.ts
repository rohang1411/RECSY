import { and, eq, inArray, isNotNull, lte, gte, sql, type SQL } from 'drizzle-orm';

import { phones } from '@/services/db/schema';

import type { BrowseFilterState } from './search-params';

/**
 * Build Drizzle `where` for active phones and {@link BrowseFilterState}.
 * Foldable is read from `spec_json` JSONB (`PhoneSpecSchema.foldable`).
 */
export function browseWhereFromState(state: BrowseFilterState): SQL {
  const parts: SQL[] = [eq(phones.status, 'active')];

  if (state.brands.length > 0) {
    parts.push(inArray(phones.brand, [...state.brands]));
  }

  if (state.minPriceUsd != null) {
    parts.push(isNotNull(phones.msrpUsd));
    parts.push(gte(phones.msrpUsd, String(state.minPriceUsd)));
  }
  if (state.maxPriceUsd != null) {
    parts.push(isNotNull(phones.msrpUsd));
    parts.push(lte(phones.msrpUsd, String(state.maxPriceUsd)));
  }

  if (state.foldable === 'yes') {
    parts.push(sql`coalesce((${phones.specJson})::jsonb->>'foldable', 'false') = 'true'`);
  } else if (state.foldable === 'no') {
    parts.push(sql`coalesce((${phones.specJson})::jsonb->>'foldable', 'false') = 'false'`);
  }

  if (parts.length === 1) {
    return parts[0]!;
  }
  return and(...(parts as [SQL, SQL, ...SQL[]]));
}

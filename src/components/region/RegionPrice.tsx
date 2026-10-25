/**
 * RegionPrice client island (Plan 26 WP-08).
 * Displays price tailored to the client's selected region cookie.
 * On server-render and pre-mount, renders the default region (US) price to prevent CLS.
 */
'use client';

import { useClientRegion } from '@/lib/region-client';
import { formatLocalPrice } from '@/lib/format-currency';
import { DEFAULT_REGION_CODE, getRegionConfig } from '@/lib/regions';
import type { PhoneRegionalPrice } from '@/services/cache/public-data';

export interface RegionPriceProps {
  readonly regionalPrices: Record<string, PhoneRegionalPrice>;
  readonly msrpUsd: string | null;
  readonly className?: string;
}

export function RegionPrice({ regionalPrices, msrpUsd, className }: RegionPriceProps) {
  const { region, isMounted } = useClientRegion();
  const activeRegion = isMounted ? region : getRegionConfig(DEFAULT_REGION_CODE);
  const detail = regionalPrices[activeRegion.countryCode];
  const rawPrice = detail?.price ?? msrpUsd;
  const isEstimated = detail?.isEstimated ?? false;
  const formatted = formatLocalPrice(rawPrice, activeRegion, { isEstimated });

  return <span className={className}>{formatted ?? 'TBD'}</span>;
}

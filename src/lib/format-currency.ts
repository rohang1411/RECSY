import { type RegionConfig } from './regions';

/**
 * Format a price for display in the given region.
 *
 * @param price - Raw numeric string from DB or a number
 * @param regionConfig - The active region from getRegionConfig()
 * @param options.isEstimated - When true, prepends '~' to indicate conversion
 * @returns Formatted string e.g. '₹65,999' or '~₹67,400' or null
 */
export function formatLocalPrice(
  price: string | number | null | undefined,
  regionConfig: RegionConfig,
  options?: { isEstimated?: boolean },
): string | null {
  if (price == null || price === '') return null;
  const n = typeof price === 'string' ? Number.parseFloat(price) : price;
  if (!Number.isFinite(n)) return null;

  const formatted = n.toLocaleString(regionConfig.locale, {
    style: 'currency',
    currency: regionConfig.currency,
    maximumFractionDigits: 0,
  });

  return options?.isEstimated ? `~${formatted}` : formatted;
}

/**
 * Keep legacy USD-only function for internal dashboard and pipeline telemetry.
 * All user-facing code should use formatLocalPrice instead.
 */
export function formatUsdFromNumericString(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/**
 * Format a Postgres `numeric` MSRP string for display. Returns `null` when
 * input is null/undefined/empty.
 */
export function formatUsdFromNumericString(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

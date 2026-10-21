import type { QueryLease } from './lease';

/**
 * Resolves whether the current query is allowed to run with Deep reasoning mode.
 * Seam for WP-04: returns 'fast' until WP-13 activates full entitlement resolution.
 * (Subscribers and BYOK users will receive 'deep' once WP-13 implements entitlement check).
 */
export async function resolveReasoningMode(
  _identity: { userId: string | null },
  lease: QueryLease,
  requestedMode?: 'fast' | 'deep',
): Promise<'fast' | 'deep'> {
  if (lease.chargeSource === 'byok' && requestedMode === 'deep') {
    return 'deep';
  }
  return 'fast';
}

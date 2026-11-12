/**
 * Retrieves the target phone metadata for `/api/ask` by slug.
 * Safe to run in parallel with admission rate-limiting and before quota reservation.
 *
 * Plan 26 WP-07: Delegates to public-data.ts for tagged data cache reads.
 */
import type { AppQueryDb } from '@/services/db/client';
import {
  getAskPhoneTarget as getCachedTarget,
  type CachedAskPhoneTarget,
} from '@/services/cache/public-data';

export type AskPhoneTarget = CachedAskPhoneTarget;

export async function getAskPhoneTarget(
  db: AppQueryDb,
  slug: string,
): Promise<AskPhoneTarget | null> {
  return getCachedTarget(slug, db);
}

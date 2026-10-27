import { sql, type SQL } from 'drizzle-orm';
import type { RequestIdentity } from '@/services/auth/identity';

export type SessionOwner =
  | { kind: 'user'; userId: string; deviceId?: string }
  | { kind: 'device'; deviceId: string }
  | { kind: 'none' };

/**
 * Derives the session owner from an admitted request identity.
 * - Authenticated users are owned by `user_id`. Real device ID (if present) is kept for guest import.
 * - Anonymous callers with a minted device cookie are owned by `device_id`.
 * - Anonymous callers without a device cookie ('nocookie:*') own nothing.
 */
export function ownerFromIdentity(identity: RequestIdentity): SessionOwner {
  if (identity.userId) {
    const isNoCookie = !identity.deviceId || identity.deviceId.startsWith('nocookie:');
    return {
      kind: 'user',
      userId: identity.userId,
      deviceId: isNoCookie ? undefined : identity.deviceId,
    };
  }

  if (identity.deviceId && !identity.deviceId.startsWith('nocookie:')) {
    return {
      kind: 'device',
      deviceId: identity.deviceId,
    };
  }

  return { kind: 'none' };
}

/**
 * Builds the canonical SQL owner predicate.
 * Normative reference: Plan 27 Section 7.3.
 *
 * - User: s.user_id = $userId
 * - Device: s.user_id IS NULL AND s.device_id = $deviceId
 * - None: 1 = 0 (never matches)
 */
export function buildOwnerPredicate(owner: SessionOwner, tableAlias = 's'): SQL {
  const prefix = tableAlias ? `${tableAlias}.` : '';
  if (owner.kind === 'user') {
    return sql`${sql.raw(prefix)}user_id = ${owner.userId}::uuid`;
  }
  if (owner.kind === 'device') {
    return sql`${sql.raw(prefix)}user_id IS NULL AND ${sql.raw(prefix)}device_id = ${owner.deviceId}`;
  }
  return sql`1 = 0`;
}

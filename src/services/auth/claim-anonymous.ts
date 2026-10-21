import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'auth-claim-anonymous' });

export interface ClaimAnonymousResult {
  readonly success: boolean;
  readonly freeUsedMerged?: number;
  readonly clientClaimed?: boolean;
}

/**
 * Anonymous-to-account graduation (Section 8.6).
 * Merges today's anonymous device usage into the user's quota counters via `recsy_link_device_to_user`,
 * and associates unowned recommendation sessions (`recsy_rec_session` cookie) with the new user id.
 *
 * Idempotent. Any internal database failure is logged and safely handled so sign-in is never blocked.
 */
export async function claimAnonymousState(
  db: AppQueryDb,
  userId: string,
  deviceId: string,
  sessionToken?: string | null,
): Promise<ClaimAnonymousResult> {
  if (!userId || !deviceId) {
    return { success: false };
  }

  try {
    // 1. Link device usage to user counter
    const linkRes = await db.execute<{ recsy_link_device_to_user: number }>(sql`
      SELECT recsy_link_device_to_user(${userId}::uuid, ${deviceId});
    `);
    const freeUsedMerged = linkRes[0]?.recsy_link_device_to_user ?? 0;

    // 2. Claim unowned recommendation client if present
    let clientClaimed = false;
    if (sessionToken?.trim()) {
      const updateRes = await db.execute(sql`
        UPDATE recommendation_clients
           SET user_id = ${userId}::uuid
         WHERE client_token = ${sessionToken.trim()}
           AND user_id IS NULL;
      `);
      // In postgres-js, update result returns row count if available
      clientClaimed = Boolean(updateRes.length ?? true);
    }

    log.info({ userId, deviceId, freeUsedMerged, clientClaimed }, 'claimed anonymous state');

    return {
      success: true,
      freeUsedMerged,
      clientClaimed,
    };
  } catch (err) {
    log.error({ err, userId, deviceId }, 'failed to claim anonymous state (non-fatal)');
    return { success: false };
  }
}

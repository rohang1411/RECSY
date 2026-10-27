import { sql } from 'drizzle-orm';
import { isValidUuid } from '@/lib/uuid';
import type { AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'auth-claim-anonymous' });

export interface ClaimAnonymousResult {
  readonly success: boolean;
  readonly freeUsedMerged?: number;
  readonly clientClaimed?: boolean;
  readonly sessionsClaimed?: number;
}

/**
 * Extracts a recommendation session UUID from a returnTo or redirect URL if present.
 */
export function extractSessionIdFromReturnTo(returnTo?: string | null): string | null {
  if (!returnTo) return null;
  const match = returnTo.match(
    /\/recommend\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return match ? match[1]! : null;
}

/**
 * Anonymous-to-account graduation (Plan 25 Section 8.6, Plan 27 Section 7.6).
 * Merges today's anonymous device usage into the user's quota counters via `recsy_link_device_to_user`,
 * and associates unowned recommendation sessions with the new user id:
 *   (a) sessions explicitly presented by client / returnTo matching this device
 *   (b) legacy `recsy_rec_session` cookie session
 *
 * Idempotent. Any internal database failure is logged and safely handled so sign-in is never blocked.
 */
export async function claimAnonymousState(
  db: AppQueryDb,
  userId: string,
  deviceId: string,
  sessionToken?: string | null,
  presentedSessionIds?: readonly string[] | null,
): Promise<ClaimAnonymousResult> {
  if (!userId || !deviceId || !isValidUuid(userId)) {
    return { success: false };
  }

  try {
    // 1. Link device usage to user counter
    const linkRes = await db.execute<{ recsy_link_device_to_user: number }>(sql`
      SELECT recsy_link_device_to_user(${userId}::uuid, ${deviceId});
    `);
    const freeUsedMerged = linkRes?.[0]?.recsy_link_device_to_user ?? 0;

    // 2. Claim unowned recommendation client if present
    let clientClaimed = false;
    if (sessionToken?.trim()) {
      const updateRes = await db.execute<{ id: string }>(sql`
        UPDATE recommendation_clients
           SET user_id = ${userId}::uuid
         WHERE client_token = ${sessionToken.trim()}
           AND user_id IS NULL
        RETURNING id;
      `);
      clientClaimed = (updateRes.length ?? 0) > 0;
      if (clientClaimed && updateRes[0]?.id) {
        await db.execute(sql`
          UPDATE recommendation_sessions
             SET user_id = ${userId}::uuid
           WHERE client_id = ${updateRes[0].id}::uuid
             AND user_id IS NULL;
        `);
      }
    }

    // 3. Plan 27 Section 7.6: Claim explicitly presented session IDs belonging to this device
    let sessionsClaimed = 0;
    if (presentedSessionIds && presentedSessionIds.length > 0) {
      for (const sId of presentedSessionIds) {
        if (isValidUuid(sId)) {
          const claimedSession = await db.execute<{ id: string; client_id: string | null }>(sql`
            UPDATE recommendation_sessions
               SET user_id = ${userId}::uuid
             WHERE id = ${sId}::uuid
               AND user_id IS NULL
               AND device_id = ${deviceId}
            RETURNING id, client_id;
          `);
          if (claimedSession.length > 0) {
            sessionsClaimed++;
            if (claimedSession[0]?.client_id) {
              await db.execute(sql`
                UPDATE recommendation_clients
                   SET user_id = ${userId}::uuid
                 WHERE id = ${claimedSession[0].client_id}::uuid
                   AND user_id IS NULL;
              `);
            }
          }
        }
      }
    }

    log.info(
      { userId, deviceId, freeUsedMerged, clientClaimed, sessionsClaimed },
      'claimed anonymous state',
    );

    return {
      success: true,
      freeUsedMerged,
      clientClaimed,
      sessionsClaimed,
    };
  } catch (err) {
    log.error({ err, userId, deviceId }, 'failed to claim anonymous state (non-fatal)');
    return { success: false };
  }
}

import { sql } from 'drizzle-orm';
import type { QueryLease } from './lease';
import { getDb, type AppQueryDb } from '@/services/db/client';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'reasoning-mode-router' });

/**
 * Resolves whether the current query is allowed to run with Deep reasoning mode.
 * Normative reference: Section 7.6, 9.2, WP-13 of plan 25.
 *
 * Rules:
 *   1. Callers requesting 'fast' (or omitting request) always receive 'fast'.
 *   2. BYOK callers with lease.chargeSource === 'byok' receive 'deep' if requested.
 *   3. Pro subscribers with an active or trialing subscription in the subscriptions table
 *      (or lease.chargeSource === 'subscription') receive 'deep' if requested.
 *   4. All other callers (anonymous, free daily allowance, credit pack holders without Pro)
 *      are downgraded to 'fast' regardless of client headers.
 */
export async function resolveReasoningMode(
  identity: { userId: string | null; deviceId?: string },
  lease: QueryLease,
  requestedMode?: 'fast' | 'deep',
  db?: AppQueryDb,
): Promise<'fast' | 'deep'> {
  if (requestedMode !== 'deep') {
    return 'fast';
  }

  // 1. BYOK callers run on their own provider key and are entitled to Deep reasoning
  if (lease.chargeSource === 'byok') {
    return 'deep';
  }

  // 2. Pro subscription holders
  if (identity.userId) {
    if (lease.chargeSource === 'subscription') {
      return 'deep';
    }

    try {
      const dbClient = db ?? getDb();
      const rows = await dbClient.execute<{ status: string; entitled_until: string | Date }>(sql`
        SELECT status, entitled_until
        FROM subscriptions
        WHERE user_id = ${identity.userId}::uuid
          AND status IN ('active', 'trialing')
          AND entitled_until > now()
        ORDER BY entitled_until DESC
        LIMIT 1
      `);

      if (rows.length > 0) {
        return 'deep';
      }
    } catch (err) {
      log.warn(
        { err, userId: identity.userId },
        'failed to query subscriber status for deep reasoning; defaulting to fast',
      );
    }
  }

  // 3. Non-entitled caller downgraded to fast
  return 'fast';
}

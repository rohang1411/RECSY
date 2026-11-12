/**
 * Account history wiping service.
 * Normative reference: Plan 25 Section 10.5, 15.2.
 *
 * Removes conversational history (sessions, turns, feedback) and Q&A queries.
 * Keeps profile, wallet balance, active subscription, and billing ledger intact.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';

export async function deleteUserHistory(
  db: AppQueryDb,
  userId: string,
): Promise<{ deleted: number }> {
  // 1. Delete recommendation sessions directly owned by user (cascades turns and feedback)
  const sessionRows = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM recommendation_sessions
       WHERE user_id = ${userId}::uuid
      RETURNING id
    )
    SELECT count(*)::int AS count FROM deleted;
  `);

  // 2. Delete recommendation clients owned by user
  const clientRows = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM recommendation_clients
       WHERE user_id = ${userId}::uuid
      RETURNING id
    )
    SELECT count(*)::int AS count FROM deleted;
  `);

  // 3. Delete phone Q&A chat queries
  const chatRows = await db.execute<{ count: number }>(sql`
    WITH deleted AS (
      DELETE FROM chat_queries
       WHERE user_id = ${userId}::uuid
      RETURNING id
    )
    SELECT count(*)::int AS count FROM deleted;
  `);

  const totalDeleted =
    (sessionRows[0]?.count ?? 0) + (clientRows[0]?.count ?? 0) + (chatRows[0]?.count ?? 0);
  return { deleted: totalDeleted };
}

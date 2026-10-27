/**
 * Recommendation session CRUD — anonymous multi-turn session management.
 *
 * `insertRecommendationSession` creates a new anonymous session keyed by a
 * random cookie token. `findSessionByCookie` loads an existing session. No
 * authentication required; sessions are anonymous and store no PII beyond
 * an IP hash.
 *
 * `getLatestRequirementsForSession` and `getLatestRecommendPickIds` load the
 * most recent extracted requirements and phone picks from prior turns so the
 * recommender pipeline can refine over past context without re-extracting.
 *
 * `nextTurnIndex` returns the next sequential turn number for a session.
 *
 * Used by: `src/app/api/recommend/route.ts`,
 *          `src/services/recommender/run-recommendation.ts`.
 */
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import type { AppDb, AppQueryDb } from '@/services/db/client';
import {
  recommendationClients,
  recommendationSessions,
  recommendationTurns,
} from '@/services/db/schema';

import {
  normalizeUserRequirements,
  userRequirementsSchema,
  type UserRequirements,
} from './requirements-schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecommendationSessionRow = typeof recommendationSessions.$inferSelect;
export type RecommendationTurnRow = typeof recommendationTurns.$inferSelect;

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function insertRecommendationSession(
  db: AppDb,
  input: {
    sessionCookie: string;
    ipHash: string | null;
    userAgent: string | null;
    userId?: string | null;
    deviceId?: string | null;
  },
): Promise<RecommendationSessionRow> {
  // Ownership is established on the product path, atomically with the session.
  // Never attach a new session to an arbitrary pre-existing client to satisfy the FK.
  return db.transaction(async (tx) => {
    const [client] = await tx
      .insert(recommendationClients)
      .values({
        clientToken: input.sessionCookie,
        ipHash: input.ipHash ?? undefined,
        userAgent: input.userAgent ?? undefined,
        userId: input.userId ?? undefined,
      })
      .returning({ id: recommendationClients.id });
    if (!client) throw new Error('Failed to establish recommendation session ownership');
    const [row] = await tx
      .insert(recommendationSessions)
      .values({
        clientId: client.id,
        sessionCookie: input.sessionCookie,
        userId: input.userId ?? undefined,
        deviceId: input.deviceId ?? undefined,
        lastTurnAt: new Date(),
      })
      .returning();
    if (!row) throw new Error('Failed to insert recommendation session');
    return row;
  });
}

export async function findSessionByCookie(
  db: AppQueryDb,
  sessionCookie: string,
  options?: { userId?: string | null },
): Promise<RecommendationSessionRow | null> {
  const [result] = await db
    .select({
      session: recommendationSessions,
      clientUserId: recommendationClients.userId,
      clientId: recommendationClients.id,
    })
    .from(recommendationSessions)
    .innerJoin(recommendationClients, eq(recommendationSessions.clientId, recommendationClients.id))
    .where(
      and(
        eq(recommendationSessions.sessionCookie, sessionCookie),
        eq(recommendationSessions.status, 'active'),
      ),
    )
    .limit(1);

  if (!result) return null;

  const { session, clientUserId, clientId } = result;

  if (options !== undefined) {
    const currentUserId = options.userId ?? null;

    if (currentUserId !== null) {
      // Authenticated caller
      if (clientUserId === currentUserId) {
        return session;
      }
      if (clientUserId === null) {
        // Unowned client graduating to authenticated user (Section 8.6)
        await db
          .update(recommendationClients)
          .set({ userId: currentUserId, lastSeenAt: new Date() })
          .where(and(eq(recommendationClients.id, clientId), isNull(recommendationClients.userId)));
        return session;
      }
      // Belongs to a different user - never steal it!
      return null;
    }

    // Anonymous caller: client must not belong to an authenticated user
    if (clientUserId !== null) {
      return null;
    }
  }

  return session;
}

// ---------------------------------------------------------------------------
// Turn helpers
// ---------------------------------------------------------------------------

export async function nextTurnIndex(db: AppQueryDb, sessionId: string): Promise<number> {
  const [last] = await db
    .select({ turnIndex: recommendationTurns.turnIndex })
    .from(recommendationTurns)
    .where(eq(recommendationTurns.sessionId, sessionId))
    .orderBy(desc(recommendationTurns.turnIndex))
    .limit(1);
  return last ? last.turnIndex + 1 : 0;
}

// ---------------------------------------------------------------------------
// Context loaders for the pipeline
// ---------------------------------------------------------------------------

/**
 * Returns the most recent parseable `extractedRequirements` for a session, or
 * `null` if the session has no prior turns with parsed requirements.
 *
 * Clarification turns are intentionally included: the extractor still captures
 * partial state (budget, platform, priorities) before asking a follow-up, and
 * the next user message must merge into that partial state instead of starting
 * over.
 */
export async function getLatestRequirementsForSession(
  db: AppQueryDb,
  sessionId: string,
): Promise<UserRequirements | null> {
  const turns = await db
    .select({ extractedRequirements: recommendationTurns.extractedRequirements })
    .from(recommendationTurns)
    .where(
      and(
        eq(recommendationTurns.sessionId, sessionId),
        isNotNull(recommendationTurns.extractedRequirements),
      ),
    )
    .orderBy(desc(recommendationTurns.turnIndex))
    .limit(10);

  for (const turn of turns) {
    const parsed = userRequirementsSchema.safeParse(turn.extractedRequirements);
    if (parsed.success) {
      return normalizeUserRequirements(parsed.data);
    }
  }
  return null;
}

/**
 * Returns the phone IDs of the most recent `recommend`-intent turn picks,
 * or `[]` if the session has no prior picks.
 */
export async function getLatestRecommendPickIds(
  db: AppQueryDb,
  sessionId: string,
): Promise<string[]> {
  const [turn] = await db
    .select({ candidatePhoneIds: recommendationTurns.candidatePhoneIds })
    .from(recommendationTurns)
    .where(
      and(
        eq(recommendationTurns.sessionId, sessionId),
        eq(recommendationTurns.intent, 'recommend'),
      ),
    )
    .orderBy(desc(recommendationTurns.turnIndex))
    .limit(1);

  return turn?.candidatePhoneIds ?? [];
}

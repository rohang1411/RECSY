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
import { and, desc, eq, isNotNull } from 'drizzle-orm';

import type { AppDb } from '@/services/db/client';
import { recommendationSessions, recommendationTurns } from '@/services/db/schema';

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
    clientId?: string;
    ipHash: string | null;
    userAgent: string | null;
    title?: string;
  },
): Promise<RecommendationSessionRow> {
  let clientId = input.clientId;
  if (!clientId) {
    const { getOrCreateClient } = await import('./session-manager');
    const { client } = await getOrCreateClient(db, {
      clientToken: input.sessionCookie,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
    });
    clientId = client.id;
  }

  const [row] = await db
    .insert(recommendationSessions)
    .values({
      clientId,
      sessionCookie: input.sessionCookie,
      title: input.title ?? 'New Recommendation',
    })
    .returning();
  if (!row) throw new Error('Failed to insert recommendation session');
  return row;
}

export async function findSessionByCookie(
  db: AppDb,
  sessionCookie: string,
): Promise<RecommendationSessionRow | null> {
  const [row] = await db
    .select()
    .from(recommendationSessions)
    .where(eq(recommendationSessions.sessionCookie, sessionCookie))
    .limit(1);
  if (row) return row;

  const { recommendationClients } = await import('@/services/db/schema');
  const [client] = await db
    .select()
    .from(recommendationClients)
    .where(eq(recommendationClients.clientToken, sessionCookie))
    .limit(1);
  if (!client) return null;

  const [session] = await db
    .select()
    .from(recommendationSessions)
    .where(
      and(
        eq(recommendationSessions.clientId, client.id),
        eq(recommendationSessions.status, 'active'),
      ),
    )
    .orderBy(desc(recommendationSessions.updatedAt))
    .limit(1);
  return session ?? null;
}

// ---------------------------------------------------------------------------
// Turn helpers
// ---------------------------------------------------------------------------

export async function nextTurnIndex(db: AppDb, sessionId: string): Promise<number> {
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
  db: AppDb,
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
export async function getLatestRecommendPickIds(db: AppDb, sessionId: string): Promise<string[]> {
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

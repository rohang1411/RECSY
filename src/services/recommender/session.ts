import { desc, eq } from 'drizzle-orm';

import type { AppDb } from '@/services/db/client';
import { recommendationSessions, recommendationTurns } from '@/services/db/schema';

import {
  normalizeUserRequirements,
  userRequirementsSchema,
  type UserRequirements,
} from './requirements-schema';

export async function findSessionByCookie(
  db: AppDb,
  cookie: string,
): Promise<{ id: string } | null> {
  const [row] = await db
    .select({ id: recommendationSessions.id })
    .from(recommendationSessions)
    .where(eq(recommendationSessions.sessionCookie, cookie))
    .limit(1);
  return row ?? null;
}

export async function insertRecommendationSession(
  db: AppDb,
  input: {
    readonly sessionCookie: string;
    readonly ipHash: string | null;
    readonly userAgent: string | null;
  },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(recommendationSessions)
    .values({
      sessionCookie: input.sessionCookie,
      ipHash: input.ipHash,
      userAgent: input.userAgent,
    })
    .returning({ id: recommendationSessions.id });
  if (!row) throw new Error('insertRecommendationSession: no row returned');
  return row;
}

export async function getLatestRequirementsForSession(
  db: AppDb,
  sessionId: string,
): Promise<UserRequirements | null> {
  const [row] = await db
    .select({ extractedRequirements: recommendationTurns.extractedRequirements })
    .from(recommendationTurns)
    .where(eq(recommendationTurns.sessionId, sessionId))
    .orderBy(desc(recommendationTurns.turnIndex))
    .limit(1);

  const raw = row?.extractedRequirements;
  if (!raw || typeof raw !== 'object') return null;
  const parsed = userRequirementsSchema.safeParse(raw);
  return parsed.success ? normalizeUserRequirements(parsed.data) : null;
}

export async function nextTurnIndex(db: AppDb, sessionId: string): Promise<number> {
  const [row] = await db
    .select({ turnIndex: recommendationTurns.turnIndex })
    .from(recommendationTurns)
    .where(eq(recommendationTurns.sessionId, sessionId))
    .orderBy(desc(recommendationTurns.turnIndex))
    .limit(1);
  return (row?.turnIndex ?? -1) + 1;
}

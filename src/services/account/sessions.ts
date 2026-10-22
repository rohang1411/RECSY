/**
 * Cross-device recommendation session management.
 * Normative reference: Plan 25 Section 11.6.1, 15.2, WP-18.
 */
import { sql } from 'drizzle-orm';
import type { AppQueryDb } from '@/services/db/client';

export interface UserSessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  deviceMarker?: string;
  turnsCount: number;
}

export interface ListUserSessionsResult {
  sessions: UserSessionSummary[];
  nextCursor: string | null;
}

export interface UserSessionTurn {
  id: string;
  turnIndex: number;
  userMessage: string;
  intent: string;
  extractedRequirements: Record<string, unknown> | null;
  picks: unknown[] | null;
  clarifyingQuestion: string | null;
  createdAt: string;
}

export interface UserSessionDetail extends UserSessionSummary {
  turns: UserSessionTurn[];
}

export function formatDeviceMarker(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent.toLowerCase();

  let browser = 'Web';
  if (ua.includes('edg/')) browser = 'Edge';
  else if (ua.includes('chrome/')) browser = 'Chrome';
  else if (ua.includes('safari/') && !ua.includes('chrome')) browser = 'Safari';
  else if (ua.includes('firefox/')) browser = 'Firefox';

  let os = 'Device';
  if (ua.includes('windows')) os = 'Windows';
  else if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) os = 'iOS';
  else if (ua.includes('android')) os = 'Android';
  else if (ua.includes('macintosh') || ua.includes('mac os')) os = 'macOS';
  else if (ua.includes('linux')) os = 'Linux';

  return `${browser} on ${os}`;
}

export async function listUserSessions(
  db: AppQueryDb,
  userId: string,
  options?: {
    cursor?: string | null;
    limit?: number;
  },
): Promise<ListUserSessionsResult> {
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
  const cursorDate = options?.cursor ? new Date(options.cursor) : null;
  const validCursor = cursorDate && !Number.isNaN(cursorDate.getTime()) ? cursorDate : null;

  type QueryRow = Record<string, unknown> & {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    userAgent: string | null;
    turnsCount: number;
  };

  const rows = await db.execute<QueryRow>(sql`
    SELECT
      s.id,
      s.title,
      s.created_at AS "createdAt",
      s.updated_at AS "updatedAt",
      c.user_agent AS "userAgent",
      COUNT(t.id)::int AS "turnsCount"
    FROM recommendation_sessions s
    JOIN recommendation_clients c ON s.client_id = c.id
    LEFT JOIN recommendation_turns t ON t.session_id = s.id
    WHERE c.user_id = ${userId}::uuid
      AND s.status = 'active'
      ${validCursor ? sql`AND s.updated_at < ${validCursor}` : sql``}
    GROUP BY s.id, s.title, s.created_at, s.updated_at, c.user_agent
    ORDER BY s.updated_at DESC
    LIMIT ${limit + 1};
  `);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? new Date(lastItem.updatedAt).toISOString() : null;

  const sessions: UserSessionSummary[] = items.map((r) => ({
    id: r.id,
    title: r.title || 'Untitled Session',
    createdAt: new Date(r.createdAt).toISOString(),
    updatedAt: new Date(r.updatedAt).toISOString(),
    deviceMarker: formatDeviceMarker(r.userAgent),
    turnsCount: r.turnsCount ?? 0,
  }));

  return { sessions, nextCursor };
}

export async function getUserSessionDetail(
  db: AppQueryDb,
  userId: string,
  sessionId: string,
): Promise<UserSessionDetail | null> {
  type SessionRow = Record<string, unknown> & {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    userAgent: string | null;
  };

  const sessionRows = await db.execute<SessionRow>(sql`
    SELECT
      s.id,
      s.title,
      s.created_at AS "createdAt",
      s.updated_at AS "updatedAt",
      c.user_agent AS "userAgent"
    FROM recommendation_sessions s
    JOIN recommendation_clients c ON s.client_id = c.id
    WHERE s.id = ${sessionId}::uuid
      AND c.user_id = ${userId}::uuid
      AND s.status = 'active'
    LIMIT 1;
  `);

  const session = sessionRows[0];
  if (!session) return null;

  type TurnRow = Record<string, unknown> & {
    id: string;
    turnIndex: number;
    userMessage: string;
    intent: string;
    extractedRequirements: Record<string, unknown> | null;
    picks: unknown[] | null;
    clarifyingQuestion: string | null;
    createdAt: Date;
  };

  const turnRows = await db.execute<TurnRow>(sql`
    SELECT
      id,
      turn_index AS "turnIndex",
      user_message AS "userMessage",
      intent,
      extracted_requirements AS "extractedRequirements",
      picks,
      clarifying_question AS "clarifyingQuestion",
      created_at AS "createdAt"
    FROM recommendation_turns
    WHERE session_id = ${sessionId}::uuid
    ORDER BY turn_index ASC;
  `);

  const turns: UserSessionTurn[] = turnRows.map((t) => ({
    id: t.id,
    turnIndex: t.turnIndex,
    userMessage: t.userMessage,
    intent: t.intent,
    extractedRequirements: t.extractedRequirements,
    picks: t.picks,
    clarifyingQuestion: t.clarifyingQuestion,
    createdAt: new Date(t.createdAt).toISOString(),
  }));

  return {
    id: session.id,
    title: session.title || 'Untitled Session',
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    deviceMarker: formatDeviceMarker(session.userAgent),
    turnsCount: turns.length,
    turns,
  };
}

export async function deleteUserSession(
  db: AppQueryDb,
  userId: string,
  sessionId: string,
): Promise<{ deleted: boolean }> {
  const result = await db.execute<{ id: string }>(sql`
    DELETE FROM recommendation_sessions s
    USING recommendation_clients c
    WHERE s.client_id = c.id
      AND s.id = ${sessionId}::uuid
      AND c.user_id = ${userId}::uuid
    RETURNING s.id;
  `);

  return { deleted: (result.length ?? 0) > 0 };
}

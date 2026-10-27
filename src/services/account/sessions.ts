/**
 * Cross-device recommendation session management.
 * Delegated to the recommendation sessions v2 domain service (Plan 27 WP-03).
 */
import type { AppDb, AppQueryDb } from '@/services/db/client';
import {
  formatDeviceMarker,
  getSessionDetail,
  listSessions,
  softDeleteSession,
} from '@/services/recommender/sessions';

export { formatDeviceMarker };

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

export async function listUserSessions(
  db: AppQueryDb,
  userId: string,
  options?: {
    cursor?: string | null;
    limit?: number;
  },
): Promise<ListUserSessionsResult> {
  const result = await listSessions(
    db,
    { kind: 'user', userId },
    {
      cursor: options?.cursor,
      limit: options?.limit,
      status: 'active',
      includePinned: true,
    },
  );

  const allSessions = [...(result.pinned ?? []), ...result.sessions];
  const sessions: UserSessionSummary[] = allSessions.map((s) => ({
    id: s.id,
    title: s.title || 'Untitled Session',
    createdAt: s.createdAt,
    updatedAt: s.lastTurnAt,
    deviceMarker: s.deviceMarker,
    turnsCount: s.turnCount,
  }));

  return {
    sessions,
    nextCursor: result.nextCursor,
  };
}

export async function getUserSessionDetail(
  db: AppQueryDb,
  userId: string,
  sessionId: string,
): Promise<UserSessionDetail | null> {
  const detail = await getSessionDetail(db, sessionId, { kind: 'user', userId });
  if (!detail) return null;

  const turns: UserSessionTurn[] = detail.turns.map((t) => ({
    id: t.id,
    turnIndex: t.turnIndex,
    userMessage: t.userMessage,
    intent: t.intent,
    extractedRequirements: null,
    picks: t.picks,
    clarifyingQuestion: t.clarifyingQuestion,
    createdAt: t.createdAt,
  }));

  return {
    id: detail.id,
    title: detail.title || 'Untitled Session',
    createdAt: detail.createdAt,
    updatedAt: detail.lastTurnAt,
    deviceMarker: detail.deviceMarker,
    turnsCount: detail.turnCount,
    turns,
  };
}

export async function deleteUserSession(
  db: AppDb,
  userId: string,
  sessionId: string,
): Promise<{ deleted: boolean }> {
  return softDeleteSession(db, sessionId, { kind: 'user', userId });
}

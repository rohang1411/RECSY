/**
 * Recommendation Session Manager — Production Multi-Session Persistence & Lifecycle.
 *
 * Implements architectural isolation of conversational threads:
 * - Decouples client identity (`clientToken`) from conversation threads (`sessionId`).
 * - Provides full CRUD operations for isolated threads (list, create, get, update, delete).
 * - Manages public read-only shares (`recommendationShares`).
 * - Verifies session ownership to prevent cross-client data access.
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import type { AppDb } from '@/services/db/client';
import {
  recommendationClients,
  recommendationSessions,
  recommendationShares,
  recommendationTurns,
} from '@/services/db/schema';
import type { RecommendApiPick } from './run-recommendation';

export type RecommendationClientRow = typeof recommendationClients.$inferSelect;
export type RecommendationSessionRow = typeof recommendationSessions.$inferSelect;
export type RecommendationTurnRow = typeof recommendationTurns.$inferSelect;
export type RecommendationShareRow = typeof recommendationShares.$inferSelect;

export interface SessionSummary {
  readonly id: string;
  readonly title: string;
  readonly primaryIntent: string | null;
  readonly isPinned: boolean;
  readonly status: 'active' | 'closed' | 'archived' | 'deleted';
  readonly lastTurnIndex: number;
  readonly picksSummary: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface HydratedTurn {
  readonly turnIndex: number;
  readonly userMessage: string;
  readonly assistantText: string;
  readonly kind: 'results' | 'clarify';
  readonly picks: readonly RecommendApiPick[];
  readonly relaxed: readonly string[];
  readonly refined: boolean;
  readonly scoresTied: boolean;
  readonly scorecardMissing: boolean;
  readonly topAspects: readonly string[];
  readonly createdAt: string;
}

export function formatAssistantResultsText(
  picks: readonly RecommendApiPick[] = [],
  relaxed: readonly string[] = [],
  refined = false,
): string {
  if (picks.length === 0) {
    return 'No catalog entries matched those preferences. Try relaxing one must-have or changing the budget, then ask again.';
  }
  const countLabel =
    picks.length === 1 ? 'one match' : picks.length === 2 ? 'two picks' : `top ${picks.length}`;
  const base = refined
    ? `Updated your recommendations. Returning ${countLabel}.`
    : `Recommendations are ready. Returning ${countLabel}.`;
  return relaxed.length > 0 ? `${base} Adjusted: ${relaxed.join(', ')}.` : base;
}

// ---------------------------------------------------------------------------
// Client Identity Management
// ---------------------------------------------------------------------------

export async function getOrCreateClient(
  db: AppDb,
  input: {
    readonly clientToken?: string | null;
    readonly ipHash?: string | null;
    readonly userAgent?: string | null;
  },
): Promise<{ client: RecommendationClientRow; isNew: boolean }> {
  if (input.clientToken) {
    const [existing] = await db
      .select()
      .from(recommendationClients)
      .where(eq(recommendationClients.clientToken, input.clientToken))
      .limit(1);

    if (existing) {
      // Touch lastSeenAt asynchronously
      db.update(recommendationClients)
        .set({ lastSeenAt: new Date() })
        .where(eq(recommendationClients.id, existing.id))
        .catch(() => {});
      return { client: existing, isNew: false };
    }
  }

  const newToken = input.clientToken || randomBytes(24).toString('base64url');
  const [created] = await db
    .insert(recommendationClients)
    .values({
      clientToken: newToken,
      ipHash: input.ipHash ?? undefined,
      userAgent: input.userAgent ?? undefined,
    })
    .onConflictDoUpdate({
      target: recommendationClients.clientToken,
      set: { lastSeenAt: new Date() },
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create or retrieve recommendation client');
  }

  return { client: created, isNew: true };
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export async function listSessionsForClient(
  db: AppDb,
  clientId: string,
  options?: {
    readonly limit?: number;
    readonly includeArchived?: boolean;
  },
): Promise<SessionSummary[]> {
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 100);

  const statusCondition = options?.includeArchived
    ? ne(recommendationSessions.status, 'deleted')
    : eq(recommendationSessions.status, 'active');

  const sessions = await db
    .select()
    .from(recommendationSessions)
    .where(and(eq(recommendationSessions.clientId, clientId), statusCondition))
    .orderBy(desc(recommendationSessions.isPinned), desc(recommendationSessions.updatedAt))
    .limit(limit);

  if (sessions.length === 0) {
    return [];
  }

  const sessionIds = sessions.map((s) => s.id);

  // Fetch turns with picks for summary previews
  const turns = await db
    .select({
      sessionId: recommendationTurns.sessionId,
      turnIndex: recommendationTurns.turnIndex,
      intent: recommendationTurns.intent,
      picks: recommendationTurns.picks,
    })
    .from(recommendationTurns)
    .where(inArray(recommendationTurns.sessionId, sessionIds))
    .orderBy(desc(recommendationTurns.turnIndex));

  const sessionTurnsMap = new Map<string, { lastTurnIndex: number; picksSummary: string[] }>();

  const turnRows = Array.isArray(turns) ? turns : [];
  for (const turn of turnRows) {
    const existing = sessionTurnsMap.get(turn.sessionId);
    if (!existing) {
      const picksList = Array.isArray(turn.picks) ? (turn.picks as RecommendApiPick[]) : [];
      const picksSummary = picksList.slice(0, 3).map((p) => {
        if (!p.brand) return p.model || 'Phone';
        return p.model.toLowerCase().includes(p.brand.toLowerCase())
          ? p.model
          : `${p.brand} ${p.model}`;
      });

      sessionTurnsMap.set(turn.sessionId, {
        lastTurnIndex: turn.turnIndex,
        picksSummary,
      });
    } else {
      // If the earlier recorded turn had no picks (e.g. clarify turn), grab picks from this turn
      if (
        existing.picksSummary.length === 0 &&
        Array.isArray(turn.picks) &&
        turn.picks.length > 0
      ) {
        const picksList = turn.picks as RecommendApiPick[];
        existing.picksSummary = picksList.slice(0, 3).map((p) => {
          if (!p.brand) return p.model || 'Phone';
          return p.model.toLowerCase().includes(p.brand.toLowerCase())
            ? p.model
            : `${p.brand} ${p.model}`;
        });
      }
    }
  }

  return sessions.map((s) => {
    const turnData = sessionTurnsMap.get(s.id);
    return {
      id: s.id,
      title: s.title,
      primaryIntent: s.primaryIntent,
      isPinned: s.isPinned,
      status: s.status as SessionSummary['status'],
      lastTurnIndex: turnData?.lastTurnIndex ?? 0,
      picksSummary: turnData?.picksSummary ?? [],
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  });
}

export async function createSession(
  db: AppDb,
  clientId: string,
  data?: {
    readonly title?: string;
    readonly primaryIntent?: string;
    readonly regionCode?: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<RecommendationSessionRow> {
  const [created] = await db
    .insert(recommendationSessions)
    .values({
      clientId,
      title: data?.title?.trim() || 'New Recommendation',
      primaryIntent: data?.primaryIntent,
      metadata: {
        regionCode: data?.regionCode ?? 'US',
        ...(data?.metadata ?? {}),
      },
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create recommendation session');
  }

  return created;
}

export async function getSessionWithTurns(
  db: AppDb,
  sessionId: string,
  clientId?: string,
): Promise<{
  session: RecommendationSessionRow;
  turns: HydratedTurn[];
} | null> {
  const conditions = [eq(recommendationSessions.id, sessionId)];
  if (clientId) {
    conditions.push(eq(recommendationSessions.clientId, clientId));
  }

  const [session] = await db
    .select()
    .from(recommendationSessions)
    .where(and(...conditions))
    .limit(1);

  if (!session || session.status === 'deleted') {
    return null;
  }

  const turns = await db
    .select()
    .from(recommendationTurns)
    .where(eq(recommendationTurns.sessionId, sessionId))
    .orderBy(recommendationTurns.turnIndex);

  const hydratedTurns: HydratedTurn[] = turns.map((t) => {
    const isClarify = t.intent === 'clarify';
    const picksList = Array.isArray(t.picks) ? (t.picks as RecommendApiPick[]) : [];
    const rawReq = t.extractedRequirements as Record<string, unknown> | null;
    const relaxed = Array.isArray(rawReq?.relaxed) ? (rawReq.relaxed as string[]) : [];
    const topAspects = Array.isArray(rawReq?.top_aspects)
      ? (rawReq.top_aspects as string[])
      : Array.isArray(rawReq?.priorities)
        ? (rawReq.priorities as { aspect: string }[]).map((p) => p.aspect)
        : [];

    const assistantText = isClarify
      ? t.clarifyingQuestion || 'Tell me a bit more about what you need.'
      : formatAssistantResultsText(picksList, relaxed, t.turnIndex > 0);

    return {
      turnIndex: t.turnIndex,
      userMessage: t.userMessage,
      assistantText,
      kind: isClarify ? 'clarify' : 'results',
      picks: picksList,
      relaxed,
      refined: t.turnIndex > 0,
      scoresTied: false,
      scorecardMissing: false,
      topAspects,
      createdAt: t.createdAt.toISOString(),
    };
  });

  return { session, turns: hydratedTurns };
}

export async function updateSession(
  db: AppDb,
  sessionId: string,
  clientId: string,
  updates: {
    readonly title?: string;
    readonly isPinned?: boolean;
    readonly status?: 'active' | 'closed' | 'archived' | 'deleted';
    readonly primaryIntent?: string;
    readonly metadata?: Record<string, unknown>;
  },
): Promise<RecommendationSessionRow | null> {
  const [existing] = await db
    .select({ id: recommendationSessions.id, metadata: recommendationSessions.metadata })
    .from(recommendationSessions)
    .where(
      and(eq(recommendationSessions.id, sessionId), eq(recommendationSessions.clientId, clientId)),
    )
    .limit(1);

  if (!existing) {
    return null;
  }

  const patch: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (updates.title !== undefined) {
    patch.title = updates.title.trim() || 'New Recommendation';
  }
  if (updates.isPinned !== undefined) {
    patch.isPinned = updates.isPinned;
  }
  if (updates.status !== undefined) {
    patch.status = updates.status;
  }
  if (updates.primaryIntent !== undefined) {
    patch.primaryIntent = updates.primaryIntent;
  }
  if (updates.metadata !== undefined) {
    patch.metadata = {
      ...(existing.metadata ?? {}),
      ...updates.metadata,
    };
  }

  const [updated] = await db
    .update(recommendationSessions)
    .set(patch)
    .where(eq(recommendationSessions.id, sessionId))
    .returning();

  return updated ?? null;
}

export async function deleteSession(
  db: AppDb,
  sessionId: string,
  clientId: string,
): Promise<boolean> {
  const result = await db
    .update(recommendationSessions)
    .set({
      status: 'deleted',
      updatedAt: new Date(),
    })
    .where(
      and(eq(recommendationSessions.id, sessionId), eq(recommendationSessions.clientId, clientId)),
    )
    .returning({ id: recommendationSessions.id });

  return result.length > 0;
}

// ---------------------------------------------------------------------------
// Share Snapshot Management
// ---------------------------------------------------------------------------

export async function createShareSnapshot(
  db: AppDb,
  sessionId: string,
  clientId?: string,
  options?: { readonly ttlDays?: number },
): Promise<RecommendationShareRow> {
  const hydrated = await getSessionWithTurns(db, sessionId, clientId);
  if (!hydrated) {
    throw new Error('Session not found or inaccessible for sharing');
  }

  const shareToken = randomBytes(16).toString('hex');
  const expiresAt = options?.ttlDays
    ? new Date(Date.now() + options.ttlDays * 24 * 60 * 60 * 1000)
    : null;

  const frozenState = {
    session: {
      id: hydrated.session.id,
      title: hydrated.session.title,
      createdAt: hydrated.session.createdAt.toISOString(),
    },
    turns: hydrated.turns,
    sharedAt: new Date().toISOString(),
  };

  const [share] = await db
    .insert(recommendationShares)
    .values({
      sessionId,
      shareToken,
      frozenState,
      expiresAt: expiresAt ?? undefined,
    })
    .returning();

  if (!share) {
    throw new Error('Failed to create recommendation share');
  }

  return share;
}

export async function getShareSnapshot(
  db: AppDb,
  shareToken: string,
): Promise<{
  share: RecommendationShareRow;
  frozenState: {
    session: { id: string; title: string; createdAt: string };
    turns: HydratedTurn[];
    sharedAt: string;
  };
} | null> {
  const [share] = await db
    .select()
    .from(recommendationShares)
    .where(eq(recommendationShares.shareToken, shareToken))
    .limit(1);

  if (!share) return null;

  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) {
    return null;
  }

  // Increment views count asynchronously
  db.update(recommendationShares)
    .set({ viewsCount: sql`${recommendationShares.viewsCount} + 1` })
    .where(eq(recommendationShares.id, share.id))
    .catch(() => {});

  return {
    share,
    frozenState: share.frozenState as {
      session: { id: string; title: string; createdAt: string };
      turns: HydratedTurn[];
      sharedAt: string;
    },
  };
}

/**
 * Database repository for recommendation sessions v2.
 * All queries are strictly parameterized with owner predicates.
 * Normative reference: Plan 27 Section 7, 8, 9, 17.3.
 */
import { sql } from 'drizzle-orm';
import type { AppDb, AppQueryDb } from '@/services/db/client';
import { buildOwnerPredicate, type SessionOwner } from './owner';
import { decodeSessionCursor, encodeSessionCursor } from './cursor';
import type {
  ListSessionsOptions,
  ListSessionsResult,
  PickSummary,
  ResolveOrCreateSessionParams,
  ResolveOrCreateSessionResult,
  SessionDetail,
  SessionDetailTurn,
  SessionResultMeta,
  SessionSummary,
  SessionTitleSource,
  SettleTurnParams,
  SettleTurnResult,
  UpdateSessionPatch,
} from './types';

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

export function sanitizeSessionTitle(raw: string): string {
  if (!raw) return '';
  let s = raw.normalize('NFC');
  s = s.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '');
  s = s.replace(/[*#_~`>]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'“”‘’`]+|["'“”‘’`]+$/g, '').trim();

  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const segments = Array.from(segmenter.segment(s));
    if (segments.length > 80) {
      s = segments
        .slice(0, 80)
        .map((seg) => seg.segment)
        .join('')
        .trim();
    }
  } else if (s.length > 80) {
    s = s.slice(0, 80).trim();
  }
  return s;
}

interface RawSessionRow extends Record<string, unknown> {
  id: string;
  title: string;
  titleSource: SessionTitleSource;
  firstMessage: string | null;
  isPinned: boolean;
  status: 'active' | 'archived' | 'deleted' | 'closed';
  turnCount: number;
  lastPicksSummary: PickSummary[] | null;
  createdAt: Date;
  lastTurnAt: Date;
  userAgent: string | null;
}

function mapRawSessionToSummary(row: RawSessionRow, isSignedUser: boolean): SessionSummary {
  const topPick =
    Array.isArray(row.lastPicksSummary) && row.lastPicksSummary.length > 0
      ? row.lastPicksSummary[0]
      : null;

  return {
    id: row.id,
    title: row.title || 'Untitled Session',
    titleSource: row.titleSource ?? 'default',
    firstMessage: row.firstMessage ?? null,
    isPinned: Boolean(row.isPinned),
    status: row.status,
    turnCount: row.turnCount ?? 0,
    topPick: topPick ?? null,
    createdAt: new Date(row.createdAt).toISOString(),
    lastTurnAt: new Date(row.lastTurnAt).toISOString(),
    deviceMarker: isSignedUser ? formatDeviceMarker(row.userAgent) : undefined,
  };
}

export async function resolveOrCreateSessionInDb(
  db: AppDb,
  params: ResolveOrCreateSessionParams,
): Promise<ResolveOrCreateSessionResult | null> {
  const ownerPred = buildOwnerPredicate(params.owner, 's');
  const userId = params.owner.kind === 'user' ? params.owner.userId : null;
  const deviceId =
    params.owner.kind === 'user'
      ? (params.owner.deviceId ?? null)
      : params.owner.kind === 'device'
        ? params.owner.deviceId
        : null;

  return db.transaction(async (tx) => {
    // 1. Establish/touch client record for ownership FK
    const clientRows = await tx.execute<{ id: string }>(sql`
      INSERT INTO recommendation_clients (client_token, user_id, ip_hash, user_agent)
      VALUES (${'client:' + params.id}, ${userId ? sql`${userId}::uuid` : null}, ${params.ipHash ?? null}, ${params.userAgent ?? null})
      ON CONFLICT (client_token) DO UPDATE SET last_seen_at = now()
      RETURNING id;
    `);

    const clientId = clientRows[0]?.id;
    if (!clientId) {
      throw new Error('Failed to resolve recommendation client for session');
    }

    // 2. Insert session ON CONFLICT DO NOTHING
    const insertRes = await tx.execute<{ id: string }>(sql`
      INSERT INTO recommendation_sessions (
        id,
        client_id,
        user_id,
        device_id,
        session_cookie,
        title,
        title_source,
        metadata
      ) VALUES (
        ${params.id}::uuid,
        ${clientId}::uuid,
        ${userId ? sql`${userId}::uuid` : null},
        ${deviceId},
        ${'sid:' + params.id},
        'New Recommendation',
        'default',
        ${JSON.stringify({ regionCode: params.regionCode ?? undefined, currency: params.currency ?? undefined })}::jsonb
      ) ON CONFLICT (id) DO NOTHING
      RETURNING id;
    `);

    const created = insertRes.length > 0;

    // 3. Select session matching owner and status in ('active', 'archived')
    const sessionRows = await tx.execute<{
      id: string;
      title: string;
      titleSource: SessionTitleSource;
      turnCount: number;
      status: 'active' | 'archived' | 'deleted' | 'closed';
    }>(sql`
      SELECT s.id,
             s.title,
             s.title_source AS "titleSource",
             s.turn_count AS "turnCount",
             s.status
        FROM recommendation_sessions s
       WHERE s.id = ${params.id}::uuid
         AND ${ownerPred}
         AND s.status IN ('active', 'archived')
       LIMIT 1;
    `);

    const row = sessionRows[0];
    if (!row) {
      return null;
    }

    // 4. If archived, un-archive on prompt send
    if (row.status === 'archived') {
      await tx.execute(sql`
        UPDATE recommendation_sessions
           SET status = 'active',
               archived_at = NULL,
               updated_at = now()
         WHERE id = ${params.id}::uuid;
      `);
      row.status = 'active';
    }

    return {
      session: {
        id: row.id,
        title: row.title,
        titleSource: row.titleSource,
        turnCount: row.turnCount,
        status: row.status,
      },
      created,
    };
  });
}

export async function settleTurnInDb(
  tx: AppDb,
  params: SettleTurnParams,
): Promise<SettleTurnResult | null> {
  const ownerPred = buildOwnerPredicate(params.owner, 's');
  const picksSummaryJson =
    params.hasPicks && params.picksSummary ? JSON.stringify(params.picksSummary) : null;
  const extractedRequirementsJson = params.extractedRequirements
    ? JSON.stringify(params.extractedRequirements)
    : null;
  const picksJson = params.picks ? JSON.stringify(params.picks) : null;
  const resultMetaJson = params.resultMeta ? JSON.stringify(params.resultMeta) : null;
  const candidatePhoneIds = params.candidatePhoneIds ?? [];

  // Atomic turn index allocation with row-lock serialization
  const updateRows = await tx.execute<{
    turnIndex: number;
    title: string;
    titleSource: SessionTitleSource;
    turnCount: number;
  }>(sql`
    UPDATE recommendation_sessions s
       SET next_turn_index    = s.next_turn_index + 1,
           turn_count         = s.turn_count + 1,
           last_turn_at       = now(),
           updated_at         = now(),
           first_message      = COALESCE(s.first_message, left(${params.userMessage}, 160)),
           last_picks_summary = CASE WHEN ${params.hasPicks} AND ${picksSummaryJson}::jsonb IS NOT NULL
                                     THEN ${picksSummaryJson}::jsonb
                                     ELSE s.last_picks_summary END,
           title              = CASE WHEN s.title_source IN ('default', 'heuristic') AND ${params.title ?? null} IS NOT NULL
                                     THEN ${params.title}
                                     ELSE s.title END,
           title_source       = CASE WHEN s.title_source IN ('default', 'heuristic') AND ${params.title ?? null} IS NOT NULL
                                     THEN 'heuristic'
                                     ELSE s.title_source END,
           primary_intent     = COALESCE(s.primary_intent, ${params.intent})
     WHERE s.id = ${params.sessionId}::uuid
       AND ${ownerPred}
       AND s.status = 'active'
    RETURNING s.next_turn_index - 1 AS "turnIndex",
              s.title,
              s.title_source AS "titleSource",
              s.turn_count AS "turnCount";
  `);

  const updated = updateRows[0];
  if (!updated) {
    return null;
  }

  // Insert the turn record
  await tx.execute(sql`
    INSERT INTO recommendation_turns (
      session_id,
      turn_index,
      user_message,
      intent,
      extracted_requirements,
      candidate_phone_ids,
      picks,
      clarifying_question,
      lease_id,
      result_meta
    ) VALUES (
      ${params.sessionId}::uuid,
      ${updated.turnIndex},
      ${params.userMessage},
      ${params.intent},
      ${extractedRequirementsJson ? sql`${extractedRequirementsJson}::jsonb` : null},
      ${candidatePhoneIds},
      ${picksJson ? sql`${picksJson}::jsonb` : null},
      ${params.clarifyingQuestion ?? null},
      ${params.leaseId ? sql`${params.leaseId}::uuid` : null},
      ${resultMetaJson ? sql`${resultMetaJson}::jsonb` : null}
    );
  `);

  return {
    turnIndex: updated.turnIndex,
    session: {
      title: updated.title,
      titleSource: updated.titleSource,
      turnCount: updated.turnCount,
    },
  };
}

export async function listSessionsFromDb(
  db: AppQueryDb,
  owner: SessionOwner,
  options: ListSessionsOptions,
): Promise<ListSessionsResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const ownerPred = buildOwnerPredicate(owner, 's');
  const isSignedUser = owner.kind === 'user';
  const decodedCursor = decodeSessionCursor(options.cursor);

  // Status condition
  const statusClause =
    options.status === 'archived'
      ? sql`s.status = 'archived'`
      : options.status === 'all'
        ? sql`s.status IN ('active', 'archived')`
        : sql`s.status = 'active'`;

  // Search filter
  let searchClause = sql``;
  if (options.query && options.query.trim().length > 0) {
    const escaped = options.query
      .trim()
      .slice(0, 80)
      .replace(/[%_\\]/g, '\\$&');
    const pattern = `%${escaped}%`;
    searchClause = sql`AND (s.title ILIKE ${pattern} OR s.first_message ILIKE ${pattern})`;
  }

  // Cursor filter: (last_turn_at, id) < (cursor.lastTurnAt, cursor.id)
  let cursorClause = sql``;
  if (decodedCursor) {
    cursorClause = sql`AND (s.last_turn_at, s.id) < (${decodedCursor.lastTurnAt}, ${decodedCursor.id}::uuid)`;
  }

  // Pinned filter: active session listing excludes pinned from the paginated main section
  // to avoid duplication with the pinned list
  const excludePinned = options.status !== 'archived';
  const pinnedClause = excludePinned ? sql`AND s.is_pinned = FALSE` : sql``;

  // 1. If first page and includePinned is true (and status is active/not archived), query pinned sessions
  let pinnedSummaries: SessionSummary[] | undefined;
  if (options.includePinned && !decodedCursor && options.status !== 'archived') {
    const pinnedRows = await db.execute<RawSessionRow>(sql`
      SELECT s.id,
             s.title,
             s.title_source AS "titleSource",
             s.first_message AS "firstMessage",
             s.is_pinned AS "isPinned",
             s.status,
             s.turn_count AS "turnCount",
             s.last_picks_summary AS "lastPicksSummary",
             s.created_at AS "createdAt",
             s.last_turn_at AS "lastTurnAt",
             c.user_agent AS "userAgent"
        FROM recommendation_sessions s
        LEFT JOIN recommendation_clients c ON s.client_id = c.id
       WHERE ${ownerPred}
         AND s.status = 'active'
         AND s.is_pinned = TRUE
         ${searchClause}
       ORDER BY s.last_turn_at DESC, s.id DESC
       LIMIT 50;
    `);

    pinnedSummaries = pinnedRows.map((r) => mapRawSessionToSummary(r, isSignedUser));
  }

  // 2. Query main paginated list
  const rows = await db.execute<RawSessionRow>(sql`
    SELECT s.id,
           s.title,
           s.title_source AS "titleSource",
           s.first_message AS "firstMessage",
           s.is_pinned AS "isPinned",
           s.status,
           s.turn_count AS "turnCount",
           s.last_picks_summary AS "lastPicksSummary",
           s.created_at AS "createdAt",
           s.last_turn_at AS "lastTurnAt",
           c.user_agent AS "userAgent"
      FROM recommendation_sessions s
      LEFT JOIN recommendation_clients c ON s.client_id = c.id
     WHERE ${ownerPred}
       AND ${statusClause}
       ${pinnedClause}
       ${searchClause}
       ${cursorClause}
     ORDER BY s.last_turn_at DESC, s.id DESC
     LIMIT ${limit + 1};
  `);

  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem ? encodeSessionCursor(new Date(lastItem.lastTurnAt), lastItem.id) : null;

  const sessions = items.map((r) => mapRawSessionToSummary(r, isSignedUser));

  // 3. Guest import count for signed-in users on first page
  let guestImportAvailable: number | undefined;
  if (isSignedUser && owner.deviceId && !decodedCursor) {
    const countRes = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
        FROM recommendation_sessions
       WHERE user_id IS NULL
         AND device_id = ${owner.deviceId}
         AND status = 'active'
         AND last_turn_at > now() - interval '30 days';
    `);
    const count = countRes[0]?.count ?? 0;
    if (count > 0) {
      guestImportAvailable = count;
    }
  }

  return {
    pinned: pinnedSummaries,
    sessions,
    nextCursor,
    guestImportAvailable,
  };
}

export async function getSessionDetailFromDb(
  db: AppQueryDb,
  id: string,
  owner: SessionOwner,
  options?: { limit?: number; beforeTurnIndex?: number },
): Promise<SessionDetail | null> {
  const ownerPred = buildOwnerPredicate(owner, 's');
  const isSignedUser = owner.kind === 'user';
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);

  const sessionRows = await db.execute<RawSessionRow>(sql`
    SELECT s.id,
           s.title,
           s.title_source AS "titleSource",
           s.first_message AS "firstMessage",
           s.is_pinned AS "isPinned",
           s.status,
           s.turn_count AS "turnCount",
           s.last_picks_summary AS "lastPicksSummary",
           s.created_at AS "createdAt",
           s.last_turn_at AS "lastTurnAt",
           c.user_agent AS "userAgent"
      FROM recommendation_sessions s
      LEFT JOIN recommendation_clients c ON s.client_id = c.id
     WHERE s.id = ${id}::uuid
       AND ${ownerPred}
       AND s.status IN ('active', 'archived')
     LIMIT 1;
  `);

  const sessionRow = sessionRows[0];
  if (!sessionRow) return null;

  let turnFilter = sql``;
  if (typeof options?.beforeTurnIndex === 'number') {
    turnFilter = sql`AND turn_index < ${options.beforeTurnIndex}`;
  }

  const turnRows = await db.execute<{
    id: string;
    turnIndex: number;
    userMessage: string;
    intent: string;
    clarifyingQuestion: string | null;
    picks: unknown[] | null;
    resultMeta: SessionResultMeta | null;
    createdAt: Date;
  }>(sql`
    SELECT id,
           turn_index AS "turnIndex",
           user_message AS "userMessage",
           intent,
           clarifying_question AS "clarifyingQuestion",
           picks,
           result_meta AS "resultMeta",
           created_at AS "createdAt"
      FROM recommendation_turns
     WHERE session_id = ${id}::uuid
       ${turnFilter}
     ORDER BY turn_index ASC
     LIMIT ${limit};
  `);

  const turns: SessionDetailTurn[] = turnRows.map((t) => ({
    id: t.id,
    turnIndex: t.turnIndex,
    userMessage: t.userMessage,
    intent: t.intent,
    clarifyingQuestion: t.clarifyingQuestion,
    picks: t.picks,
    resultMeta: t.resultMeta,
    createdAt: new Date(t.createdAt).toISOString(),
  }));

  const summary = mapRawSessionToSummary(sessionRow, isSignedUser);
  return {
    ...summary,
    turns,
  };
}

export async function updateSessionInDb(
  db: AppDb,
  id: string,
  owner: SessionOwner,
  patch: UpdateSessionPatch,
): Promise<{ session: SessionSummary | null; error?: string }> {
  const ownerPred = buildOwnerPredicate(owner, 's');
  const isSignedUser = owner.kind === 'user';

  // Check pin cap (max 50 pins per owner)
  if (patch.isPinned === true) {
    const pinCountRes = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
        FROM recommendation_sessions s
       WHERE ${ownerPred}
         AND s.status = 'active'
         AND s.is_pinned = TRUE;
    `);
    const currentPins = pinCountRes[0]?.count ?? 0;
    if (currentPins >= 50) {
      return { session: null, error: 'PIN_LIMIT_EXCEEDED' };
    }
  }

  const setClauses: ReturnType<typeof sql>[] = [];

  if (patch.title !== undefined) {
    const sanitized = sanitizeSessionTitle(patch.title);
    if (sanitized.length === 0) {
      // Empty title resets to heuristic
      setClauses.push(sql`title = 'New Recommendation', title_source = 'heuristic'`);
    } else {
      setClauses.push(sql`title = ${sanitized}, title_source = 'user'`);
    }
  }

  if (patch.isPinned !== undefined) {
    setClauses.push(sql`is_pinned = ${patch.isPinned}`);
  }

  if (patch.status !== undefined) {
    if (patch.status === 'archived') {
      setClauses.push(sql`status = 'archived', archived_at = now()`);
    } else if (patch.status === 'active') {
      setClauses.push(sql`status = 'active', archived_at = NULL`);
    }
  }

  if (setClauses.length === 0) {
    const current = await getSessionDetailFromDb(db, id, owner);
    return { session: current };
  }

  setClauses.push(sql`updated_at = now()`);

  const updateRows = await db.execute<RawSessionRow>(sql`
    UPDATE recommendation_sessions s
       SET ${sql.join(setClauses, sql`, `)}
     WHERE s.id = ${id}::uuid
       AND ${ownerPred}
       AND s.status IN ('active', 'archived')
    RETURNING s.id,
              s.title,
              s.title_source AS "titleSource",
              s.first_message AS "firstMessage",
              s.is_pinned AS "isPinned",
              s.status,
              s.turn_count AS "turnCount",
              s.last_picks_summary AS "lastPicksSummary",
              s.created_at AS "createdAt",
              s.last_turn_at AS "lastTurnAt",
              NULL::text AS "userAgent";
  `);

  const row = updateRows[0];
  if (!row) return { session: null };

  return { session: mapRawSessionToSummary(row, isSignedUser) };
}

export async function softDeleteSessionInDb(
  db: AppDb,
  id: string,
  owner: SessionOwner,
): Promise<{ deleted: boolean }> {
  const ownerPred = buildOwnerPredicate(owner, 's');

  return db.transaction(async (tx) => {
    const updateRes = await tx.execute<{ id: string }>(sql`
      UPDATE recommendation_sessions s
         SET status = 'deleted',
             deleted_at = now(),
             updated_at = now()
       WHERE s.id = ${id}::uuid
         AND ${ownerPred}
         AND s.status IN ('active', 'archived')
      RETURNING s.id;
    `);

    if (updateRes.length === 0) {
      return { deleted: false };
    }

    await tx.execute(sql`
      DELETE FROM recommendation_shares
       WHERE session_id = ${id}::uuid;
    `);

    return { deleted: true };
  });
}

export async function restoreSessionInDb(
  db: AppDb,
  id: string,
  owner: SessionOwner,
): Promise<{ restored: boolean }> {
  const ownerPred = buildOwnerPredicate(owner, 's');

  const rows = await db.execute<{ id: string }>(sql`
    UPDATE recommendation_sessions s
       SET status = 'active',
           deleted_at = NULL,
           updated_at = now()
     WHERE s.id = ${id}::uuid
       AND ${ownerPred}
       AND s.status = 'deleted'
       AND s.deleted_at > now() - interval '30 days'
    RETURNING s.id;
  `);

  return { restored: rows.length > 0 };
}

export async function claimGuestSessionsInDb(
  db: AppDb,
  userId: string,
  deviceId: string,
  specificSessionIds?: string[],
): Promise<{ claimed: number }> {
  let idClause = sql``;
  if (specificSessionIds && specificSessionIds.length > 0) {
    const uuidList = specificSessionIds.map((id) => sql`${id}::uuid`);
    idClause = sql`AND id IN (${sql.join(uuidList, sql`, `)})`;
  } else {
    // Broad claim: active guest sessions from last 30 days
    idClause = sql`AND status = 'active' AND last_turn_at > now() - interval '30 days'`;
  }

  return db.transaction(async (tx) => {
    const updated = await tx.execute<{ id: string; clientId: string }>(sql`
      UPDATE recommendation_sessions
         SET user_id = ${userId}::uuid,
             updated_at = now()
       WHERE user_id IS NULL
         AND device_id = ${deviceId}
         ${idClause}
      RETURNING id, client_id AS "clientId";
    `);

    if (updated.length > 0) {
      const clientIds = Array.from(new Set(updated.map((r) => r.clientId)));
      const clientUuidList = clientIds.map((cid) => sql`${cid}::uuid`);
      await tx.execute(sql`
        UPDATE recommendation_clients
           SET user_id = ${userId}::uuid,
               last_seen_at = now()
         WHERE id IN (${sql.join(clientUuidList, sql`, `)})
           AND user_id IS NULL;
      `);
    }

    return { claimed: updated.length };
  });
}

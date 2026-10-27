/**
 * Typed client fetchers for Recommendation Sessions REST API and `/api/recommend` turns (Plan 27 WP-07).
 */
import { createMeteredRequestInit } from '@/lib/metered-fetch';
import type {
  ListSessionsResult,
  SessionDetail,
  SessionDetailTurn,
  SessionResultMeta,
  SessionStatus,
  SessionSummary,
  SessionTitleSource,
  UpdateSessionPatch,
} from '@/services/recommender/sessions/types';

export type {
  ListSessionsResult,
  SessionDetail,
  SessionDetailTurn,
  SessionResultMeta,
  SessionStatus,
  SessionSummary,
  SessionTitleSource,
  UpdateSessionPatch,
};

export interface ListSessionsParams {
  cursor?: string | null;
  limit?: number;
  q?: string;
  status?: 'active' | 'archived' | 'all';
  includePinned?: boolean;
}

export interface RecommendTurnRequest {
  message: string;
  sessionId?: string;
}

export interface RecommendTurnResponse {
  kind: 'results' | 'clarify';
  clarifyingQuestion?: string;
  picks?: unknown[];
  relaxed?: string[];
  refined?: boolean;
  scoresTied?: boolean;
  scorecardMissing?: boolean;
  topAspects?: string[];
  quota: Record<string, unknown> | null;
  sessionId?: string;
  turnIndex?: number;
  session?: {
    title: string;
    titleSource: SessionTitleSource;
    turnCount: number;
    created?: boolean;
  };
  topicShift?: boolean;
  replayed?: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errorData: Record<string, unknown> | null = null;
    try {
      errorData = (await res.json()) as Record<string, unknown>;
    } catch {
      // Non-JSON error body
    }
    const errObj = (errorData?.error as Record<string, unknown> | undefined) ?? errorData;
    const message =
      (typeof errObj?.message === 'string' ? errObj.message : null) ||
      `Request failed with status ${res.status}`;
    const code = typeof errObj?.code === 'string' ? errObj.code : undefined;
    throw new ApiError(message, res.status, code, errorData);
  }
  return (await res.json()) as T;
}

/**
 * Fetch paginated list of recommendation sessions.
 */
export async function fetchSessionList(
  params: ListSessionsParams = {},
): Promise<ListSessionsResult> {
  const query = new URLSearchParams();
  if (params.cursor) query.set('cursor', params.cursor);
  if (params.limit) query.set('limit', String(params.limit));
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.includePinned !== undefined) query.set('includePinned', String(params.includePinned));

  const url = `/api/recommend/sessions${query.toString() ? `?${query.toString()}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  return handleResponse<ListSessionsResult>(res);
}

/**
 * Fetch full session detail with turns.
 */
export async function fetchSessionDetail(
  id: string,
  opts?: { turnsLimit?: number },
): Promise<SessionDetail> {
  const query = new URLSearchParams();
  if (opts?.turnsLimit) query.set('turnsLimit', String(opts.turnsLimit));

  const url = `/api/recommend/sessions/${encodeURIComponent(id)}${query.toString() ? `?${query.toString()}` : ''}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  return handleResponse<SessionDetail>(res);
}

/**
 * Create a new session explicitly.
 */
export async function createSession(params: { title?: string } = {}): Promise<SessionSummary> {
  const res = await fetch('/api/recommend/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(params),
  });
  return handleResponse<SessionSummary>(res);
}

/**
 * Update an existing session (rename, pin, archive).
 */
export async function updateSession(
  id: string,
  patch: UpdateSessionPatch,
): Promise<SessionSummary> {
  const res = await fetch(`/api/recommend/sessions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  return handleResponse<SessionSummary>(res);
}

/**
 * Soft-delete a session.
 */
export async function deleteSession(id: string): Promise<{ ok: boolean; deletedAt: string }> {
  const res = await fetch(`/api/recommend/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  return handleResponse<{ ok: boolean; deletedAt: string }>(res);
}

/**
 * Restore a soft-deleted session within 30 days.
 */
export async function restoreSession(id: string): Promise<SessionSummary> {
  const res = await fetch(`/api/recommend/sessions/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  return handleResponse<SessionSummary>(res);
}

/**
 * Claim guest sessions from the current device for the authenticated user.
 */
export async function claimGuestSessions(deviceToken?: string): Promise<{ claimedCount: number }> {
  const res = await fetch('/api/recommend/sessions/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(deviceToken ? { deviceToken } : {}),
  });
  return handleResponse<{ claimedCount: number }>(res);
}

/**
 * Send a conversation turn with request metering headers attached.
 */
export async function sendTurn(
  body: RecommendTurnRequest,
  customRequestId?: string,
): Promise<RecommendTurnResponse> {
  const init = createMeteredRequestInit(
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    },
    customRequestId,
  );

  const res = await fetch('/api/recommend', init);
  return handleResponse<RecommendTurnResponse>(res);
}

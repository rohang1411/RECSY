/**
 * Multi-Session State Store & Multi-Tab Synchronization.
 *
 * Implements:
 * - Session history caching in localStorage + authoritative server sync.
 * - Cross-tab real-time event broadcasting via `BroadcastChannel('recsy_session_bus')`.
 * - Optimistic session mutations (create, rename, pin, soft-delete, undo-restore).
 */

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

export type SessionSyncEvent =
  | { readonly type: 'SESSION_CREATED'; readonly session: SessionSummary }
  | {
      readonly type: 'SESSION_UPDATED';
      readonly session: Partial<SessionSummary> & { readonly id: string };
    }
  | { readonly type: 'SESSION_DELETED'; readonly id: string }
  | { readonly type: 'SESSION_RESTORED'; readonly session: SessionSummary };

const CACHE_KEY = 'recsy:sessions:cache:v1';
const BROADCAST_CHANNEL_NAME = 'recsy_session_bus';

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return null;
  }
  if (!broadcastChannel) {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
  }
  return broadcastChannel;
}

export function broadcastSessionEvent(event: SessionSyncEvent): void {
  try {
    const ch = getBroadcastChannel();
    ch?.postMessage(event);
  } catch {
    // Ignore environments where BroadcastChannel is blocked
  }
}

export function readCachedSessions(): SessionSummary[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeCachedSessions(sessions: readonly SessionSummary[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(sessions));
  } catch {
    // Quota exceeded
  }
}

// ---------------------------------------------------------------------------
// Network API Client Calls
// ---------------------------------------------------------------------------

export async function fetchClientSessions(options?: {
  readonly limit?: number;
  readonly includeArchived?: boolean;
}): Promise<SessionSummary[]> {
  const url = new URL('/api/recommend/sessions', window.location.origin);
  if (options?.limit) url.searchParams.set('limit', String(options.limit));
  if (options?.includeArchived) url.searchParams.set('includeArchived', 'true');

  const res = await fetch(url.toString(), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to load sessions (${res.status})`);
  }

  const data = (await res.json()) as { sessions: SessionSummary[] };
  const sessions = data.sessions || [];
  writeCachedSessions(sessions);
  return sessions;
}

export async function apiCreateSession(data?: {
  readonly title?: string;
  readonly regionCode?: string;
}): Promise<SessionSummary> {
  const res = await fetch('/api/recommend/sessions', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data || {}),
  });

  if (!res.ok) {
    throw new Error(`Failed to create session (${res.status})`);
  }

  const json = (await res.json()) as { session: SessionSummary };
  const session = json.session;
  broadcastSessionEvent({ type: 'SESSION_CREATED', session });
  return session;
}

export async function apiRenameSession(id: string, title: string): Promise<void> {
  const res = await fetch(`/api/recommend/sessions/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ title }),
  });

  if (!res.ok) {
    throw new Error(`Failed to rename session (${res.status})`);
  }

  broadcastSessionEvent({
    type: 'SESSION_UPDATED',
    session: { id, title },
  });
}

export async function apiTogglePinSession(id: string, isPinned: boolean): Promise<void> {
  const res = await fetch(`/api/recommend/sessions/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ isPinned }),
  });

  if (!res.ok) {
    throw new Error(`Failed to pin session (${res.status})`);
  }

  broadcastSessionEvent({
    type: 'SESSION_UPDATED',
    session: { id, isPinned },
  });
}

export async function apiDeleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/recommend/sessions/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to delete session (${res.status})`);
  }

  broadcastSessionEvent({
    type: 'SESSION_DELETED',
    id,
  });
}

export async function apiRestoreSession(id: string): Promise<SessionSummary> {
  const res = await fetch(`/api/recommend/sessions/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ status: 'active' }),
  });

  if (!res.ok) {
    throw new Error(`Failed to restore session (${res.status})`);
  }

  const json = (await res.json()) as { session: SessionSummary };
  const session = json.session;
  broadcastSessionEvent({
    type: 'SESSION_RESTORED',
    session,
  });
  return session;
}

export async function apiShareSession(
  id: string,
): Promise<{ shareToken: string; shareUrl: string }> {
  const res = await fetch(`/api/recommend/sessions/${id}/share`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`Failed to share session (${res.status})`);
  }

  return (await res.json()) as { shareToken: string; shareUrl: string };
}

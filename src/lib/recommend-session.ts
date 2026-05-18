/**
 * Session persistence for the recommend page.
 *
 * Saves the conversation thread, picks, and result flags to `sessionStorage`
 * so navigating to a phone page and returning does not lose results.
 *
 * `sessionStorage` (not `localStorage`) is intentional:
 *   - Scoped to the browser tab — back/forward navigation within the same tab
 *     restores the session as expected.
 *   - Cleared automatically when the tab closes — stale picks from an old
 *     session never bleed into a new browsing session.
 *   - Private-browsing compatible with a graceful try/catch fallback.
 *
 * Versioning: the key includes `v1` so any future shape change can simply
 * bump to `v2`; the old entry will be ignored and cleared.
 */

const SESSION_KEY = 'recsy:session:recommend:v1';

/** 24 hours in ms — picks older than this are considered stale and discarded. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionChatLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface SessionPick {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
  readonly msrpUsd: string | null;
  readonly imageUrl: string | null;
}

export interface RecommendSession {
  /** ISO unix timestamp (ms) when this snapshot was saved. */
  readonly savedAt: number;
  readonly lines: readonly SessionChatLine[];
  readonly picks: readonly SessionPick[] | null;
  readonly relaxed: readonly string[] | null;
  readonly refined: boolean;
  readonly scoresTied: boolean;
  readonly scorecardMissing: boolean;
  readonly topAspects: readonly string[];
  readonly snapshots?: readonly RecommendationSnapshot[];
  readonly activeSnapshotId?: string | null;
}

export interface RecommendationSnapshot {
  readonly id: string;
  readonly query: string;
  readonly assistantText: string;
  readonly picks: readonly SessionPick[];
  readonly relaxed: readonly string[];
  readonly refined: boolean;
  readonly scoresTied: boolean;
  readonly scorecardMissing: boolean;
  readonly topAspects: readonly string[];
  readonly savedAt: number;
}

function isChatLine(v: unknown): v is SessionChatLine {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (r.role === 'user' || r.role === 'assistant') && typeof r.text === 'string';
}

function isPick(v: unknown): v is SessionPick {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.phoneId === 'string' &&
    typeof r.slug === 'string' &&
    typeof r.brand === 'string' &&
    typeof r.model === 'string' &&
    typeof r.score === 'number' &&
    typeof r.summary === 'string'
  );
}

function isSnapshot(v: unknown): v is RecommendationSnapshot {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.query === 'string' &&
    typeof r.assistantText === 'string' &&
    typeof r.savedAt === 'number' &&
    Array.isArray(r.picks) &&
    r.picks.every(isPick) &&
    Array.isArray(r.relaxed) &&
    r.relaxed.every((item) => typeof item === 'string') &&
    Array.isArray(r.topAspects) &&
    r.topAspects.every((item) => typeof item === 'string') &&
    typeof r.refined === 'boolean' &&
    typeof r.scoresTied === 'boolean' &&
    typeof r.scorecardMissing === 'boolean'
  );
}

function validateSession(raw: unknown): RecommendSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.savedAt !== 'number') return null;
  if (Date.now() - r.savedAt > SESSION_TTL_MS) return null;

  if (!Array.isArray(r.lines) || !r.lines.every(isChatLine)) return null;

  const picks =
    r.picks === null
      ? null
      : Array.isArray(r.picks) && r.picks.every(isPick)
        ? (r.picks as SessionPick[])
        : null;

  const relaxed =
    r.relaxed === null
      ? null
      : Array.isArray(r.relaxed) && r.relaxed.every((x) => typeof x === 'string')
        ? (r.relaxed as string[])
        : [];

  const topAspects =
    Array.isArray(r.topAspects) && r.topAspects.every((x) => typeof x === 'string')
      ? (r.topAspects as string[])
      : [];

  return {
    savedAt: r.savedAt,
    lines: r.lines as SessionChatLine[],
    picks,
    relaxed,
    refined: r.refined === true,
    scoresTied: r.scoresTied === true,
    scorecardMissing: r.scorecardMissing === true,
    topAspects,
    snapshots:
      Array.isArray(r.snapshots) && r.snapshots.every(isSnapshot)
        ? (r.snapshots as RecommendationSnapshot[]).slice(0, 8)
        : undefined,
    activeSnapshotId: typeof r.activeSnapshotId === 'string' ? r.activeSnapshotId : null,
  };
}

/** Read and validate the persisted session. Returns `null` if absent, invalid, or expired. */
export function readRecommendSession(): RecommendSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return validateSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Persist the current session state. Silent no-op on storage errors. */
export function writeRecommendSession(session: RecommendSession): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded or storage disabled — silently ignore.
  }
}

/** Remove the persisted session (e.g. user starts a new query). */
export function clearRecommendSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Ignore.
  }
}

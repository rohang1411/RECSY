/**
 * Per-session input draft management in sessionStorage (Plan 27 WP-07).
 *
 * Saves uncommitted user input per session (`recsy:draft:v1:<sessionId|new>`)
 * so switching between sessions preserves typed text and avoids losing work.
 */

const DRAFT_PREFIX = 'recsy:draft:v1:';

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function getDraftKey(sessionId?: string | null): string {
  const normalizedId = sessionId && sessionId.trim() ? sessionId.trim() : 'new';
  return `${DRAFT_PREFIX}${normalizedId}`;
}

/**
 * Retrieve saved draft text for a session.
 */
export function getDraft(sessionId?: string | null): string {
  if (!isBrowser()) return '';
  try {
    return window.sessionStorage.getItem(getDraftKey(sessionId)) || '';
  } catch {
    return '';
  }
}

/**
 * Persist draft text for a session. If text is empty, the key is removed.
 */
export function setDraft(sessionId: string | null | undefined, text: string): void {
  if (!isBrowser()) return;
  const key = getDraftKey(sessionId);
  try {
    if (!text || !text.trim()) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, text);
    }
  } catch {
    // Quota or disabled storage
  }
}

/**
 * Clear draft for a given session.
 */
export function clearDraft(sessionId?: string | null): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(getDraftKey(sessionId));
  } catch {
    // Ignore
  }
}

/**
 * Clear all session drafts (e.g. on sign-out or cache purge).
 */
export function clearAllDrafts(): void {
  if (!isBrowser()) return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(DRAFT_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore
  }
}

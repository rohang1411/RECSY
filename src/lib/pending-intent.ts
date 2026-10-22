/**
 * Preserves user text and intent across auth redirects, payment hops, or quota denials.
 * Normative reference: Plan 25 Section 12.5.
 */

const STORAGE_KEY = 'recsy:pending-intent';
const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface PendingIntent {
  readonly text: string;
  readonly route: string;
  readonly savedAt: number;
}

export function savePendingIntent(intent: { text: string; route: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const payload: PendingIntent = {
      text: intent.text,
      route: intent.route,
      savedAt: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Gracefully ignore storage quota / private browsing errors
  }
}

export function readPendingIntent(): PendingIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<PendingIntent>;
    if (
      typeof parsed?.text !== 'string' ||
      typeof parsed?.route !== 'string' ||
      typeof parsed?.savedAt !== 'number'
    ) {
      clearPendingIntent();
      return null;
    }

    if (Date.now() - parsed.savedAt > TTL_MS) {
      clearPendingIntent();
      return null;
    }

    return parsed as PendingIntent;
  } catch {
    return null;
  }
}

export function clearPendingIntent(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

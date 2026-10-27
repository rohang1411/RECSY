/**
 * Pure recency grouping for recommendation session history (Plan 27 WP-09).
 *
 * Groups sessions into local-time buckets:
 * - Pinned (if any)
 * - Today
 * - Yesterday
 * - Previous 7 days
 * - Previous 30 days
 * - Month and Year (e.g., 'February 2026')
 */
import type { SessionSummary } from '@/lib/recommend-sessions/api';

export interface HistoryGroup {
  readonly label: string;
  readonly items: SessionSummary[];
}

/**
 * Returns the start of the day (midnight 00:00:00.000) for a given date in local time.
 */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Group session summaries by recency relative to a reference timestamp (`now`).
 */
export function groupByRecency(
  sessions: readonly SessionSummary[],
  options?: { now?: number; includePinnedGroup?: boolean },
): HistoryGroup[] {
  if (!sessions || sessions.length === 0) {
    return [];
  }

  const nowMs = options?.now ?? Date.now();
  const nowDate = new Date(nowMs);
  const includePinnedGroup = options?.includePinnedGroup ?? true;

  const todayStart = startOfDay(nowDate);
  const oneDayMs = 24 * 60 * 60 * 1000;
  const yesterdayStart = todayStart - oneDayMs;
  const sevenDaysStart = todayStart - 6 * oneDayMs;
  const thirtyDaysStart = todayStart - 29 * oneDayMs;

  const pinnedItems: SessionSummary[] = [];
  const todayItems: SessionSummary[] = [];
  const yesterdayItems: SessionSummary[] = [];
  const prev7DaysItems: SessionSummary[] = [];
  const prev30DaysItems: SessionSummary[] = [];
  const monthBuckets = new Map<string, SessionSummary[]>();

  for (const session of sessions) {
    if (includePinnedGroup && session.isPinned) {
      pinnedItems.push(session);
      continue;
    }

    const itemDate = new Date(session.lastTurnAt || session.createdAt);
    const itemMs = itemDate.getTime();

    if (itemMs >= todayStart) {
      todayItems.push(session);
    } else if (itemMs >= yesterdayStart) {
      yesterdayItems.push(session);
    } else if (itemMs >= sevenDaysStart) {
      prev7DaysItems.push(session);
    } else if (itemMs >= thirtyDaysStart) {
      prev30DaysItems.push(session);
    } else {
      const monthLabel = itemDate.toLocaleDateString(undefined, {
        month: 'long',
        year: 'numeric',
      });
      const list = monthBuckets.get(monthLabel) ?? [];
      list.push(session);
      monthBuckets.set(monthLabel, list);
    }
  }

  const groups: HistoryGroup[] = [];

  if (pinnedItems.length > 0) {
    groups.push({ label: 'Pinned', items: pinnedItems });
  }
  if (todayItems.length > 0) {
    groups.push({ label: 'Today', items: todayItems });
  }
  if (yesterdayItems.length > 0) {
    groups.push({ label: 'Yesterday', items: yesterdayItems });
  }
  if (prev7DaysItems.length > 0) {
    groups.push({ label: 'Previous 7 days', items: prev7DaysItems });
  }
  if (prev30DaysItems.length > 0) {
    groups.push({ label: 'Previous 30 days', items: prev30DaysItems });
  }

  for (const [label, items] of monthBuckets.entries()) {
    if (items.length > 0) {
      groups.push({ label, items });
    }
  }

  return groups;
}

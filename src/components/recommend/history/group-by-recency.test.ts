import { describe, expect, it } from 'vitest';
import { groupByRecency } from './group-by-recency';
import type { SessionSummary } from '@/lib/recommend-sessions/api';

function makeSession(id: string, isoTime: string, isPinned = false): SessionSummary {
  return {
    id,
    title: `Session ${id}`,
    titleSource: 'heuristic',
    firstMessage: 'prompt',
    isPinned,
    status: 'active',
    turnCount: 1,
    topPick: null,
    createdAt: isoTime,
    lastTurnAt: isoTime,
  };
}

describe('WP-09 groupByRecency', () => {
  it('returns empty array when given no sessions', () => {
    expect(groupByRecency([])).toEqual([]);
  });

  it('groups sessions correctly relative to a fixed timestamp', () => {
    // 2026-03-15T12:00:00Z local reference time
    const fixedNow = new Date(2026, 2, 15, 12, 0, 0).getTime();

    const todaySession = makeSession('today-1', new Date(2026, 2, 15, 10, 30, 0).toISOString());
    const yesterdaySession = makeSession(
      'yesterday-1',
      new Date(2026, 2, 14, 18, 0, 0).toISOString(),
    );
    const fiveDaysAgoSession = makeSession(
      'prev7-1',
      new Date(2026, 2, 10, 14, 0, 0).toISOString(),
    );
    const twentyDaysAgoSession = makeSession(
      'prev30-1',
      new Date(2026, 1, 25, 12, 0, 0).toISOString(),
    );
    const twoMonthsAgoSession = makeSession(
      'older-1',
      new Date(2026, 0, 10, 12, 0, 0).toISOString(),
    );
    const pinnedSession = makeSession(
      'pinned-1',
      new Date(2026, 1, 1, 12, 0, 0).toISOString(),
      true,
    );

    const groups = groupByRecency(
      [
        todaySession,
        yesterdaySession,
        fiveDaysAgoSession,
        twentyDaysAgoSession,
        twoMonthsAgoSession,
        pinnedSession,
      ],
      { now: fixedNow },
    );

    expect(groups.length).toBe(6);
    expect(groups[0]?.label).toBe('Pinned');
    expect(groups[0]?.items[0]?.id).toBe('pinned-1');

    expect(groups[1]?.label).toBe('Today');
    expect(groups[1]?.items[0]?.id).toBe('today-1');

    expect(groups[2]?.label).toBe('Yesterday');
    expect(groups[2]?.items[0]?.id).toBe('yesterday-1');

    expect(groups[3]?.label).toBe('Previous 7 days');
    expect(groups[3]?.items[0]?.id).toBe('prev7-1');

    expect(groups[4]?.label).toBe('Previous 30 days');
    expect(groups[4]?.items[0]?.id).toBe('prev30-1');

    expect(groups[5]?.label).toContain('January 2026');
    expect(groups[5]?.items[0]?.id).toBe('older-1');
  });

  it('correctly handles midnight boundary (23:59 yesterday vs 00:01 today)', () => {
    const todayMidnight = new Date(2026, 5, 20, 14, 0, 0).getTime();
    const justAfterMidnight = new Date(2026, 5, 20, 0, 1, 0).toISOString();
    const justBeforeMidnight = new Date(2026, 5, 19, 23, 59, 0).toISOString();

    const sessToday = makeSession('s-today', justAfterMidnight);
    const sessYesterday = makeSession('s-yesterday', justBeforeMidnight);

    const groups = groupByRecency([sessToday, sessYesterday], { now: todayMidnight });

    expect(groups.find((g) => g.label === 'Today')?.items[0]?.id).toBe('s-today');
    expect(groups.find((g) => g.label === 'Yesterday')?.items[0]?.id).toBe('s-yesterday');
  });
});

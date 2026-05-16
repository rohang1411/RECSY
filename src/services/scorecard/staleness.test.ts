/**
 * Unit tests for the scorecard staleness guard (`staleness.ts`).
 *
 * Tests cover: `getLastScorecardFingerprint` returns null when no complete
 * successful fingerprint exists, returns the complete fingerprint when one
 * does, and `computeChunkFingerprint` forwards the DB result correctly.
 *
 * DB is mocked — no real Postgres connections.
 */
import { describe, expect, it, vi } from 'vitest';

function makeDb(rows: unknown[]) {
  return {
    execute: vi.fn().mockResolvedValue(rows),
  };
}

const { computeChunkFingerprint, getCompletedAspectsForFingerprint, getLastScorecardFingerprint } =
  await import('./staleness');

describe('getLastScorecardFingerprint', () => {
  it('returns null when no complete successful scorecard fingerprint exists', async () => {
    const db = makeDb([]);
    const result = await getLastScorecardFingerprint(db as never, 'phone-id-1');
    expect(result).toBeNull();
  });

  it('returns the fingerprint from the most recent complete successful run', async () => {
    const db = makeDb([{ chunk_fingerprint: 'abc123def456' }]);
    const result = await getLastScorecardFingerprint(db as never, 'phone-id-1');
    expect(result).toBe('abc123def456');
  });
});

describe('computeChunkFingerprint', () => {
  it('returns the md5 fingerprint from DB result', async () => {
    const db = makeDb([{ fingerprint: 'deadbeef12345678' }]);
    const result = await computeChunkFingerprint(db as never, 'phone-id-1');
    expect(result).toBe('deadbeef12345678');
  });

  it('returns empty string when DB result is empty', async () => {
    const db = makeDb([]);
    const result = await computeChunkFingerprint(db as never, 'phone-id-1');
    expect(result).toBe('');
  });
});

describe('getCompletedAspectsForFingerprint', () => {
  it('returns completed aspect names for a reusable fingerprint', async () => {
    const db = makeDb([{ aspect: 'camera' }, { aspect: 'battery' }]);
    const result = await getCompletedAspectsForFingerprint(db as never, 'phone-id-1', 'abc');
    expect([...result].sort()).toEqual(['battery', 'camera']);
  });

  it('does not query for an empty fingerprint', async () => {
    const db = makeDb([{ aspect: 'camera' }]);
    const result = await getCompletedAspectsForFingerprint(db as never, 'phone-id-1', '');
    expect(result.size).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });
});

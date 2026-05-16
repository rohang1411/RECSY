/**
 * Unit tests for the scorecard staleness guard (`staleness.ts`).
 *
 * Tests cover: `getLastScorecardFingerprint` returns null when no prior
 * successful runs exist, returns the fingerprint string when one does,
 * and `computeChunkFingerprint` forwards the DB result correctly.
 *
 * DB is mocked — no real Postgres connections.
 */
import { describe, expect, it, vi } from 'vitest';

const mockExecute = vi.fn();

vi.mock('@/services/db/client', () => ({
  getDb: vi.fn(),
}));

// We need to mock the db object passed as parameter
function makeDb(
  overrides: Partial<{
    execute: typeof mockExecute;
  }> = {},
) {
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  };
  return {
    execute: overrides.execute ?? mockExecute,
    ...selectChain,
    select: vi.fn().mockReturnValue(selectChain),
  };
}

const { computeChunkFingerprint, getLastScorecardFingerprint } = await import('./staleness');

describe('getLastScorecardFingerprint', () => {
  it('returns null when no successful scorecard runs exist', async () => {
    const db = makeDb();
    (db.select().from().where().orderBy().limit as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await getLastScorecardFingerprint(db as never, 'phone-id-1');
    expect(result).toBeNull();
  });

  it('returns the fingerprint from the most recent successful run', async () => {
    const db = makeDb();
    (db.select().from().where().orderBy().limit as ReturnType<typeof vi.fn>).mockResolvedValue([
      { chunkFingerprint: 'abc123def456' },
    ]);
    const result = await getLastScorecardFingerprint(db as never, 'phone-id-1');
    expect(result).toBe('abc123def456');
  });
});

describe('computeChunkFingerprint', () => {
  it('returns the md5 fingerprint from DB result', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ fingerprint: 'deadbeef12345678' }]),
    };
    const result = await computeChunkFingerprint(db as never, 'phone-id-1');
    expect(result).toBe('deadbeef12345678');
  });

  it('returns empty string when DB result is empty', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([]),
    };
    const result = await computeChunkFingerprint(db as never, 'phone-id-1');
    expect(result).toBe('');
  });
});

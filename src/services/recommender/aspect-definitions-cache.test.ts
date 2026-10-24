import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppQueryDb } from '@/services/db/client';
import {
  getCachedAspectDefinitions,
  getAspectDefinitionsCacheStats,
  resetAspectDefinitionsCacheForTest,
  invalidateAspectDefinitionsCache,
} from './aspect-definitions-cache';

describe('getCachedAspectDefinitions', () => {
  const fakeRows = [
    {
      id: 'def-1',
      aspect: 'battery' as const,
      version: 1,
      description: 'Battery life',
      queryPrompts: ['battery'],
      defaultWeight: '0.200',
      createdAt: new Date(),
    },
  ];

  let mockDb: AppQueryDb;
  let mockSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetAspectDefinitionsCacheForTest();
    mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockResolvedValue(fakeRows),
    });
    mockDb = {
      select: mockSelect,
    } as unknown as AppQueryDb;
  });

  it('queries database on cache miss and caches results', async () => {
    const rows = await getCachedAspectDefinitions(mockDb);
    expect(rows).toEqual(fakeRows);
    expect(mockSelect).toHaveBeenCalledTimes(1);

    const stats = getAspectDefinitionsCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(0);

    // Second call hits cache
    const cachedRows = await getCachedAspectDefinitions(mockDb);
    expect(cachedRows).toEqual(fakeRows);
    expect(mockSelect).toHaveBeenCalledTimes(1);

    const statsAfter = getAspectDefinitionsCacheStats();
    expect(statsAfter.misses).toBe(1);
    expect(statsAfter.hits).toBe(1);
  });

  it('coalesces concurrent in-flight requests to a single database load', async () => {
    let resolveQuery: (rows: typeof fakeRows) => void;
    const pendingQuery = new Promise<typeof fakeRows>((resolve) => {
      resolveQuery = resolve;
    });

    mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue(pendingQuery),
    });
    mockDb = { select: mockSelect } as unknown as AppQueryDb;

    const promise1 = getCachedAspectDefinitions(mockDb);
    const promise2 = getCachedAspectDefinitions(mockDb);

    expect(mockSelect).toHaveBeenCalledTimes(1);

    resolveQuery!(fakeRows);

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toEqual(fakeRows);
    expect(res2).toEqual(fakeRows);
  });

  it('refetches from database after invalidation', async () => {
    await getCachedAspectDefinitions(mockDb);
    expect(mockSelect).toHaveBeenCalledTimes(1);

    invalidateAspectDefinitionsCache();

    await getCachedAspectDefinitions(mockDb);
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { unstable_cache } from 'next/cache';
import {
  getPhonePageData,
  getBrowseResults,
  getActiveBrands,
  getActivePhoneSlugs,
  setPublicDataCacheEnabledForTest,
} from './public-data';
import * as dbModule from '@/services/db/client';

vi.mock('next/cache', () => ({
  unstable_cache: vi.fn((fn) => fn),
}));

describe('public-data cache readers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPublicDataCacheEnabledForTest(null);
  });

  it('rejects unsupported regions with an error', async () => {
    await expect(getPhonePageData('iphone-16', 'INVALID')).rejects.toThrow(
      /Unsupported region code/,
    );
    await expect(
      getBrowseResults(
        { brands: [], minPriceUsd: null, maxPriceUsd: null, foldable: 'any', sort: 'latest' },
        'XX',
      ),
    ).rejects.toThrow(/Unsupported region code/);
  });

  it('bypasses unstable_cache when public_data_cache is disabled', async () => {
    setPublicDataCacheEnabledForTest(false);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ brand: 'Apple' }, { brand: 'Samsung' }]),
    };
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb as never);

    const brands = await getActiveBrands();
    expect(brands).toEqual(['Apple', 'Samsung']);
    expect(unstable_cache).not.toHaveBeenCalled();
  });

  it('invokes unstable_cache with correct key parts and tags when enabled', async () => {
    setPublicDataCacheEnabledForTest(true);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ brand: 'Google' }]),
    };
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb as never);

    const brands = await getActiveBrands();
    expect(brands).toEqual(['Google']);
    expect(unstable_cache).toHaveBeenCalledWith(
      expect.any(Function),
      expect.arrayContaining(['brands']),
      expect.objectContaining({
        revalidate: 3600,
        tags: ['phones'],
      }),
    );
  });

  it('bypasses cache when browse filter exceeds 3 active dimensions', async () => {
    setPublicDataCacheEnabledForTest(true);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb as never);

    // 4 active dimensions: brands, min/max price, foldable, sort
    const filter = {
      brands: ['Apple'],
      minPriceUsd: 500,
      maxPriceUsd: 1000,
      foldable: 'yes' as const,
      sort: 'price-asc' as const,
    };

    const results = await getBrowseResults(filter, 'US');
    expect(results).toEqual([]);
    // Exceeds 3 active dimensions, so unstable_cache was NOT called
    expect(unstable_cache).not.toHaveBeenCalled();
  });

  it('serializes dates as ISO strings in getActivePhoneSlugs', async () => {
    setPublicDataCacheEnabledForTest(false);

    const testDate = new Date('2026-03-01T12:00:00.000Z');
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ slug: 'pixel-9', updatedAt: testDate }]),
    };
    vi.spyOn(dbModule, 'getDb').mockReturnValue(mockDb as never);

    const slugs = await getActivePhoneSlugs();
    expect(slugs).toEqual([{ slug: 'pixel-9', updatedAt: '2026-03-01T12:00:00.000Z' }]);
  });
});

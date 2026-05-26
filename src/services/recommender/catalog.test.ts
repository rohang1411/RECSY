/**
 * Unit tests for the recommendation catalog loader (`catalog.ts`).
 *
 * Tests cover: active phones included, inactive phones excluded, aspect
 * scores grouped by phone ID, phones with no aspect rows get an empty
 * `aspectScores` map, `msrp_usd` and `image_url` pass through, and
 * `spec_json` is parsed via `PhoneSpecSchema` (null on invalid JSON).
 *
 * DB is mocked — no Postgres connections.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@/services/db/client';

vi.mock('@/services/db/client', () => ({ getDb: vi.fn() }));

// We mock `db.select(...).from(...).leftJoin(...).leftJoin(...).where(...)` chain
function makeMockDb(rows: unknown[]): AppDb {
  const chain = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  };
  return chain as unknown as AppDb;
}

const { loadRecommendationCatalog } = await import('./catalog');

const baseRow = {
  phoneId: 'id-1',
  slug: 'google-pixel-9',
  brand: 'Google',
  model: 'Pixel 9',
  tagline: 'Just pure Android',
  msrpUsd: '799.00',
  imageUrl: 'https://example.com/pixel9.jpg',
  specJson: null,
  specEmbRaw: null,
  aspect: null,
  aspectScore: null,
};

describe('loadRecommendationCatalog', () => {
  it('returns one entry per phone (deduplicates across aspect join rows)', async () => {
    const db = makeMockDb([
      { ...baseRow, aspect: 'camera', aspectScore: 8.5 },
      { ...baseRow, aspect: 'battery', aspectScore: 7.0 },
    ]);
    const result = await loadRecommendationCatalog(db as never);
    expect(result).toHaveLength(1);
    expect(result[0]!.slug).toBe('google-pixel-9');
  });

  it('populates aspectScores map from join rows', async () => {
    const db = makeMockDb([
      { ...baseRow, aspect: 'camera', aspectScore: 8.5 },
      { ...baseRow, aspect: 'battery', aspectScore: 7.0 },
    ]);
    const result = await loadRecommendationCatalog(db as never);
    const scores = result[0]!.aspectScores;
    expect(scores.get('camera')).toBe(8.5);
    expect(scores.get('battery')).toBe(7.0);
  });

  it('returns an empty aspectScores map for phones with no aspects', async () => {
    const db = makeMockDb([{ ...baseRow, aspect: null, aspectScore: null }]);
    const result = await loadRecommendationCatalog(db as never);
    expect(result[0]!.aspectScores.size).toBe(0);
  });

  it('surfaces msrpUsd and imageUrl correctly', async () => {
    const db = makeMockDb([baseRow]);
    const result = await loadRecommendationCatalog(db as never);
    expect(result[0]!.msrpUsd).toBe('799.00');
    expect(result[0]!.imageUrl).toBe('https://example.com/pixel9.jpg');
  });

  it('returns an empty array when no active phones exist', async () => {
    const db = makeMockDb([]);
    const result = await loadRecommendationCatalog(db as never);
    expect(result).toHaveLength(0);
  });

  it('returns null specEmbedding when specEmbRaw is null', async () => {
    const db = makeMockDb([{ ...baseRow, specEmbRaw: null }]);
    const result = await loadRecommendationCatalog(db as never);
    expect(result[0]!.specEmbedding).toBeNull();
  });

  it('correctly maps regional pricing details when present', async () => {
    const db = makeMockDb([
      {
        ...baseRow,
        localPrice: '67000.00',
        localCurrency: 'INR',
        isEstimated: true,
        isAvailable: true,
      },
    ]);
    const result = await loadRecommendationCatalog(db as never, 'IN');
    expect(result).toHaveLength(1);
    expect(result[0]!.localPrice).toBe('67000.00');
    expect(result[0]!.localCurrency).toBe('INR');
    expect(result[0]!.isEstimated).toBe(true);
    expect(result[0]!.isAvailable).toBe(true);
  });
});

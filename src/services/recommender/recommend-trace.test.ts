import { describe, expect, it } from 'vitest';
import { enrichPicksWithTrace } from './recommend-trace';
import type { ScoredCandidate } from './match';
import type { PhoneCatalogEntry } from './catalog';
import type { UserRequirements } from './requirements-schema';
import type { AspectName } from '@/lib/constants';
import type { AppQueryDb } from '@/services/db/client';

function stubCandidate(id: string, score: number, brand: string, model: string): ScoredCandidate {
  return {
    phoneId: id,
    slug: `${brand.toLowerCase()}-${model.toLowerCase()}`,
    brand,
    model,
    tagline: 'Flagship phone',
    msrpUsd: '999',
    imageUrl: 'https://example.com/img.jpg',
    score,
    summary: 'Great camera and battery',
    specSemanticBonus: 0.12,
    brandBonus: 0.1,
  };
}

function stubCatalogEntry(id: string, brand: string, model: string): PhoneCatalogEntry {
  const aspectScores = new Map<AspectName, number>([
    ['camera', 9.5],
    ['battery', 8.8],
    ['performance', 9.2],
    ['display', 9.0],
    ['software', 8.5],
    ['build', 9.1],
    ['value', 7.5],
  ]);
  return {
    phoneId: id,
    slug: `${brand.toLowerCase()}-${model.toLowerCase()}`,
    brand,
    model,
    tagline: 'Flagship phone',
    msrpUsd: '999',
    imageUrl: 'https://example.com/img.jpg',
    spec: null,
    specEmbedding: null,
    aspectScores,
  };
}

const mockRequirements: UserRequirements = {
  budget_usd: { max: 1000 },
  priorities: [
    { aspect: 'camera', weight: 0.4 },
    { aspect: 'battery', weight: 0.3 },
  ],
  must_haves: ['Periscope zoom', 'All-day battery'],
  deal_breakers: [],
  use_cases: [],
  clarifying_question: undefined,
  confidence: 0.95,
  brand_preference: { liked: [], disliked: [] },
};

const mockWeights = new Map<AspectName, number>([
  ['camera', 0.4],
  ['battery', 0.3],
  ['performance', 0.1],
  ['display', 0.05],
  ['software', 0.05],
  ['build', 0.05],
  ['value', 0.05],
]);

describe('enrichPicksWithTrace', () => {
  it('returns empty array when candidates is empty', async () => {
    const res = await enrichPicksWithTrace({
      db: {} as unknown as AppQueryDb,
      candidates: [],
      catalog: [],
      requirements: mockRequirements,
      weights: mockWeights,
      funnel: { catalogCount: 20, budgetEligibleCount: 15, specEligibleCount: 10 },
    });
    expect(res).toEqual([]);
  });

  it('constructs detailed formula, aspect breakdown and vsRunnerUp', async () => {
    const c1 = stubCandidate('p1', 9.2, 'Samsung', 'Galaxy S25 Ultra');
    const c2 = stubCandidate('p2', 8.8, 'Google', 'Pixel 9 Pro XL');
    const e1 = stubCatalogEntry('p1', 'Samsung', 'Galaxy S25 Ultra');
    const e2 = stubCatalogEntry('p2', 'Google', 'Pixel 9 Pro XL');

    const res = await enrichPicksWithTrace({
      db: {
        select: () => ({
          from: () => ({
            innerJoin: () => ({
              where: () => Promise.resolve([]),
            }),
          }),
        }),
      } as unknown as AppQueryDb,
      candidates: [c1, c2],
      catalog: [e1, e2],
      requirements: mockRequirements,
      weights: mockWeights,
      funnel: { catalogCount: 30, budgetEligibleCount: 18, specEligibleCount: 12 },
    });

    expect(res).toHaveLength(2);
    const topPick = res[0]!;
    expect(topPick.trace).toBeDefined();
    expect(topPick.trace?.rank).toBe(1);
    expect(topPick.trace?.overallScore).toBe(9.2);
    expect(topPick.trace?.formula.specSemanticBonus).toBe(0.12);
    expect(topPick.trace?.funnel.catalogCount).toBe(30);
    expect(topPick.trace?.funnel.budgetEligibleCount).toBe(18);

    // Aspect breakdown check
    expect(topPick.trace?.aspectBreakdown).toHaveLength(7);
    const topAspect = topPick.trace?.aspectBreakdown[0];
    expect(topAspect?.aspect).toBe('camera');
    expect(topAspect?.weight).toBe(0.4);
    expect(topAspect?.score).toBe(9.5);

    // vsRunnerUp check for Rank 1
    expect(topPick.trace?.vsRunnerUp).toBeDefined();
    expect(topPick.trace?.vsRunnerUp?.runnerUpName).toBe('Google Pixel 9 Pro XL');
    expect(topPick.trace?.vsRunnerUp?.scoreDelta).toBe(0.4);

    // Rank 2 should not have vsRunnerUp
    const secondPick = res[1]!;
    expect(secondPick.trace?.rank).toBe(2);
    expect(secondPick.trace?.vsRunnerUp).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import type { AspectName } from '@/lib/constants';

import type { PhoneCatalogEntry } from './catalog';
import {
  buildSearchHaystack,
  dealBreakerHit,
  mustHaveMatchRatio,
  passesHardFilters,
  pickDiverseTop,
  resolveAspectWeights,
  specSemanticBonus,
  weightedAspectScore,
  type ScoredCandidate,
} from './match';
import type { UserRequirements } from './requirements-schema';

function entry(
  overrides: Partial<PhoneCatalogEntry> & Pick<PhoneCatalogEntry, 'slug'>,
): PhoneCatalogEntry {
  const scores = new Map<AspectName, number>([
    ['camera', 8],
    ['battery', 6],
    ['performance', 7],
    ['display', 7],
    ['build', 7],
    ['software', 7],
    ['value', 6],
  ]);
  return {
    phoneId: '00000000-0000-4000-8000-000000000001',
    brand: 'TestCo',
    model: 'X1',
    tagline: 'A phone',
    msrpUsd: '599.00',
    spec: null,
    specEmbedding: null,
    aspectScores: scores,
    ...overrides,
  };
}

function req(partial: Partial<UserRequirements>): UserRequirements {
  return {
    budget_usd: null,
    priorities: [],
    must_haves: [],
    deal_breakers: [],
    use_cases: [],
    form_factor: undefined,
    brand_preference: { liked: [], disliked: [] },
    confidence: 0.9,
    ...partial,
  } as UserRequirements;
}

const equalWeights = new Map<AspectName, number>(
  (['camera', 'battery', 'performance', 'display', 'build', 'software', 'value'] as const).map(
    (a) => [a, 1 / 7],
  ),
);

describe('match helpers', () => {
  it('buildSearchHaystack lowercases brand and highlights', () => {
    const e = entry({
      slug: 'a',
      brand: 'Acme',
      model: 'Z9',
      spec: {
        display: {
          size_in: 6.1,
          resolution: '1080x2400',
          refresh_rate_hz: 120,
          panel_type: 'OLED',
          features: [],
        },
        chipset: 'Q1',
        ram_gb: 8,
        storage_options_gb: [128],
        rear_cameras: [{ type: 'main', mp: 50 }],
        front_camera: { mp: 12 },
        battery_mah: 5000,
        charging: { wired_w: 30, wireless_w: 15 },
        weight_g: 190,
        os: 'Android',
        connectivity: { wifi: '7', bluetooth: '5.4', nfc: true },
        colors: [],
        foldable: false,
        highlights: ['Great Camera'],
      },
    });
    const h = buildSearchHaystack(e);
    expect(h).toContain('acme');
    expect(h).toContain('great camera');
  });

  it('passesHardFilters respects budget max', () => {
    const e = entry({ slug: 'x', msrpUsd: '800.00' });
    const r = req({ budget_usd: { max: 700, min: undefined } });
    expect(passesHardFilters(e, r, { relaxBudgetMax: false, ignoreFoldable: false })).toBe(false);
    expect(passesHardFilters(e, r, { relaxBudgetMax: true, ignoreFoldable: false })).toBe(true);
  });

  it('dealBreakerHit detects substring', () => {
    expect(dealBreakerHit('no headphone jack here', ['headphone'])).toBe(true);
    expect(dealBreakerHit('usb c only', ['headphone'])).toBe(false);
  });

  it('mustHaveMatchRatio counts matches', () => {
    expect(mustHaveMatchRatio('wireless charging and nfc', ['wireless', 'nfc'])).toBe(1);
    expect(mustHaveMatchRatio('wireless charging', ['wireless', '3.5mm'])).toBe(0.5);
  });

  it('resolveAspectWeights fills missing aspects from defaults', () => {
    const r = req({
      priorities: [{ aspect: 'camera', weight: 0.8 }],
    });
    const w = resolveAspectWeights(r, equalWeights);
    // Explicit camera weight is blended with defaulted axes (1/7 each).
    expect(w.get('camera') ?? 0).toBeGreaterThan(0.4);
    expect([...w.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('weightedAspectScore uses neutral 5 for missing aspects', () => {
    const scores = new Map<AspectName, number>([['camera', 10]]);
    const weights = new Map<AspectName, number>([
      ['camera', 0.5],
      ['battery', 0.5],
    ]);
    expect(weightedAspectScore(scores, weights)).toBe(7.5);
  });

  it('specSemanticBonus is zero without embeddings and positive when similar', () => {
    const e = entry({ slug: 's', specEmbedding: [1, 0, 0] });
    expect(specSemanticBonus(e, undefined)).toBe(0);
    expect(specSemanticBonus(e, [1, 0, 0])).toBeGreaterThan(0);
  });

  it('pickDiverseTop respects max per brand', () => {
    const base = {
      phoneId: 'x',
      model: 'm',
      tagline: null as string | null,
      summary: '',
    };
    const ranked: ScoredCandidate[] = [
      { ...base, slug: 'a', brand: 'A', score: 10 },
      { ...base, slug: 'b', brand: 'A', score: 9 },
      { ...base, slug: 'c', brand: 'A', score: 8 },
      { ...base, slug: 'd', brand: 'B', score: 7 },
    ];
    const picked = pickDiverseTop(ranked, 3, 2);
    expect(picked.map((p) => p.slug)).toEqual(['a', 'b', 'd']);
  });
});

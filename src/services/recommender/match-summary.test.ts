import { describe, expect, it } from 'vitest';

import { ASPECT_NAMES, type AspectName } from '@/lib/constants';

import type { PhoneCatalogEntry } from './catalog';
import {
  aspectsByWeight,
  hasRealAspectData,
  pickSummaryLine,
  rankCandidates,
  resolveAspectWeights,
  type SummaryContext,
} from './match';
import type { UserRequirements } from './requirements-schema';

const equalWeights = new Map<AspectName, number>(
  ASPECT_NAMES.map((a) => [a, 1 / ASPECT_NAMES.length]),
);

function neutralScores(): Map<AspectName, number> {
  return new Map<AspectName, number>(ASPECT_NAMES.map((a) => [a, 5]));
}

function goodScores(): Map<AspectName, number> {
  return new Map<AspectName, number>([
    ['camera', 8.5],
    ['battery', 6.5],
    ['performance', 7.5],
    ['display', 7.0],
    ['build', 7.0],
    ['software', 7.0],
    ['value', 6.0],
  ]);
}

function entry(slug: string, overrides: Partial<PhoneCatalogEntry> = {}): PhoneCatalogEntry {
  return {
    phoneId: `pid-${slug}`,
    slug,
    brand: 'Acme',
    model: slug,
    tagline: null,
    msrpUsd: '799.00',
    imageUrl: null,
    spec: null,
    specEmbedding: null,
    aspectScores: goodScores(),
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

describe('hasRealAspectData', () => {
  it('returns false when aspectScores is empty', () => {
    expect(hasRealAspectData(entry('a', { aspectScores: new Map() }))).toBe(false);
  });

  it('returns false when every recorded score is the neutral fallback (5)', () => {
    expect(hasRealAspectData(entry('a', { aspectScores: neutralScores() }))).toBe(false);
  });

  it('returns true when at least one score differs from 5', () => {
    expect(hasRealAspectData(entry('a', { aspectScores: goodScores() }))).toBe(true);
  });
});

describe('aspectsByWeight', () => {
  it('returns weights in descending order with deterministic tie-break', () => {
    const weights = new Map<AspectName, number>([
      ['camera', 0.4],
      ['performance', 0.2],
      ['battery', 0.2],
      ['display', 0.05],
      ['build', 0.05],
      ['software', 0.05],
      ['value', 0.05],
    ]);
    const sorted = aspectsByWeight(weights);
    expect(sorted[0]).toBe('camera');
    // camera first, then the tied 0.2 aspects in canonical order (battery < performance),
    // so index 1 should be 'battery', index 2 'performance'
    expect(sorted[1]).toBe('battery');
    expect(sorted[2]).toBe('performance');
  });
});

describe('pickSummaryLine', () => {
  const cameraFirstReq = req({
    priorities: [
      { aspect: 'camera', weight: 0.6 },
      { aspect: 'performance', weight: 0.4 },
    ],
  });
  const weights = resolveAspectWeights(cameraFirstReq, equalWeights);

  it('renders "Strongest on …" when data is present and not refined', () => {
    const ctx: SummaryContext = { weights, refined: false, corpusScorecardMissing: false };
    const line = pickSummaryLine(entry('a'), ctx);
    expect(line).toMatch(/Strongest on camera/);
    expect(line).toMatch(/aspect score 8\.5\/10/);
  });

  it('adapts to both top and secondary aspects when refined', () => {
    const ctx: SummaryContext = { weights, refined: true, corpusScorecardMissing: false };
    const line = pickSummaryLine(entry('a'), ctx);
    expect(line).toMatch(/Camera 8\.5\/10/);
    expect(line).toMatch(/performance 7\.5\/10/);
    expect(line).toMatch(/among your earlier picks/i);
  });

  it('returns an honest "no scorecard" line when the corpus lacks data', () => {
    const ctx: SummaryContext = { weights, refined: false, corpusScorecardMissing: true };
    const line = pickSummaryLine(entry('a', { aspectScores: new Map() }), ctx);
    expect(line).toMatch(/No reviewer scorecard yet/i);
  });

  it('returns a refined-aware "no scorecard" line that names top and secondary priorities', () => {
    const ctx: SummaryContext = { weights, refined: true, corpusScorecardMissing: true };
    const line = pickSummaryLine(entry('a', { aspectScores: neutralScores() }), ctx);
    expect(line).toMatch(/No reviewer scorecard yet/i);
    expect(line).toMatch(/top: camera/i);
    expect(line).toMatch(/then performance/i);
  });
});

describe('rankCandidates — tie / missing scorecard signaling', () => {
  const defaults = new Map<AspectName, number>(
    ASPECT_NAMES.map((a) => [a, 1 / ASPECT_NAMES.length]),
  );

  it('flags scoresTied + scorecardMissing when no catalog entry has real data', () => {
    const catalog = [
      entry('phone-a', { aspectScores: neutralScores() }),
      entry('phone-b', { aspectScores: neutralScores() }),
      entry('phone-c', { aspectScores: neutralScores() }),
    ];
    const result = rankCandidates(
      catalog,
      req({ priorities: [{ aspect: 'camera', weight: 1 }] }),
      defaults,
    );
    expect(result.picks.length).toBeGreaterThan(1);
    expect(result.scoresTied).toBe(true);
    expect(result.scorecardMissing).toBe(true);
    // Every summary should say "no reviewer scorecard yet".
    for (const p of result.picks) {
      expect(p.summary.toLowerCase()).toContain('no reviewer scorecard yet');
    }
  });

  it('does not flag tied/missing when at least one phone has real aspect data and the top pick separates', () => {
    const catalog = [
      entry('phone-a', { aspectScores: goodScores() }), // camera 8.5
      entry('phone-b', {
        aspectScores: new Map<AspectName, number>([
          ['camera', 6.0],
          ['battery', 6.0],
          ['performance', 6.0],
          ['display', 6.0],
          ['build', 6.0],
          ['software', 6.0],
          ['value', 6.0],
        ]),
      }),
    ];
    const result = rankCandidates(
      catalog,
      req({ priorities: [{ aspect: 'camera', weight: 1 }] }),
      defaults,
    );
    expect(result.picks[0]!.slug).toBe('phone-a');
    expect(result.scoresTied).toBe(false);
    expect(result.scorecardMissing).toBe(false);
  });
});

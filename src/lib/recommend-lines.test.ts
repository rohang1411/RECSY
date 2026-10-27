import { describe, expect, it } from 'vitest';
import { buildAssistantLines, type RecommendTurnLike } from './recommend-lines';

describe('WP-08 buildAssistantLines', () => {
  it('builds clarifying question lines', () => {
    const turn: RecommendTurnLike = {
      intent: 'clarify',
      clarifyingQuestion: 'Do you prefer iOS or Android?',
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual(['Do you prefer iOS or Android?']);
  });

  it('builds fallback clarifying question when question is missing', () => {
    const turn: RecommendTurnLike = {
      intent: 'clarify',
      clarifyingQuestion: null,
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual(['Tell me a bit more about what you need.']);
  });

  it('builds no-matches message when picks is empty', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [],
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual([
      'No catalog entries matched those preferences. Try relaxing one must-have or changing the budget, then ask again.',
    ]);
  });

  it('builds single match intro', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [{ brand: 'Google', model: 'Pixel 9', slug: 'pixel-9' }],
      refined: false,
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual(['Recommendations are ready. Returning one match.']);
  });

  it('builds two picks refined intro with relaxed adjustments', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [
        { brand: 'Google', model: 'Pixel 9', slug: 'pixel-9' },
        { brand: 'Samsung', model: 'Galaxy S25', slug: 's25' },
      ],
      refined: true,
      relaxed: ['budget raised to $800'],
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual([
      'Updated your recommendations. Returning two picks. Adjusted: budget raised to $800.',
    ]);
  });

  it('builds top N picks intro', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [
        { brand: 'Apple', model: 'iPhone 16 Pro', slug: 'iphone-16-pro' },
        { brand: 'Google', model: 'Pixel 9 Pro', slug: 'pixel-9-pro' },
        { brand: 'Samsung', model: 'Galaxy S25 Ultra', slug: 's25-ultra' },
      ],
      refined: false,
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual(['Recommendations are ready. Returning top 3.']);
  });

  it('includes tie explanation when scoresTied is true with >= 2 picks', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [
        { brand: 'Google', model: 'Pixel 9', slug: 'pixel-9' },
        { brand: 'Samsung', model: 'Galaxy S25', slug: 's25' },
      ],
      scoresTied: true,
      topAspects: ['camera', 'battery'],
    };
    const lines = buildAssistantLines(turn);
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('Recommendations are ready. Returning two picks.');
    expect(lines[1]).toContain(
      "It's a tie between Google Pixel 9 and Samsung Galaxy S25 on camera and battery.",
    );
  });

  it('includes scorecard missing notice when scorecardMissing is true', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [{ brand: 'Nothing', model: 'Phone (3)', slug: 'nothing-phone-3' }],
      scorecardMissing: true,
    };
    const lines = buildAssistantLines(turn);
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe('Recommendations are ready. Returning one match.');
    expect(lines[1]).toBe(
      'No reviewer scorecard has been ingested yet, so this ranking is specs- and priorities-only.',
    );
  });

  it('extracts metadata correctly from resultMeta nested object', () => {
    const turn: RecommendTurnLike = {
      intent: 'results',
      picks: [{ brand: 'Google', model: 'Pixel 9', slug: 'pixel-9' }],
      resultMeta: {
        relaxed: ['weight relaxed'],
        refined: true,
      },
    };
    const lines = buildAssistantLines(turn);
    expect(lines).toEqual([
      'Updated your recommendations. Returning one match. Adjusted: weight relaxed.',
    ]);
  });
});

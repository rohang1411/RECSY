import { describe, expect, it } from 'vitest';
import { getDueMilestones } from './temporal-queries';

describe('Temporal Milestone Query Engine', () => {
  it('returns launch queries for a phone aged 10 days with no scouted milestones', () => {
    const launchDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones({
      brand: 'Google',
      model: 'Pixel 9',
      launchDate,
      milestonesScouted: [],
    });

    expect(queries.some((q) => q.milestone === 'launch')).toBe(true);
    expect(queries.some((q) => q.milestone === '6m')).toBe(false);
    expect(queries.some((q) => q.milestone === '1y')).toBe(false);
    expect(queries.some((q) => q.query.includes('Pixel 9 review'))).toBe(true);
  });

  it('omits launch queries if launch is already scouted', () => {
    const launchDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones({
      brand: 'Google',
      model: 'Pixel 9',
      launchDate,
      milestonesScouted: ['launch'],
    });

    expect(queries.some((q) => q.milestone === 'launch')).toBe(false);
  });

  it('triggers 6m queries for a phone aged 160 days when 6m is not scouted', () => {
    const launchDate = new Date(Date.now() - 160 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones({
      brand: 'Samsung',
      model: 'Galaxy S24',
      launchDate,
      milestonesScouted: ['launch'],
    });

    expect(queries.some((q) => q.milestone === '6m')).toBe(true);
    expect(queries.some((q) => q.query.includes('6 months later'))).toBe(true);
    expect(queries.some((q) => q.temporalCategory === 'long_term_6m')).toBe(true);
    expect(queries.some((q) => q.temporalCategory === 'reliability')).toBe(true);
  });

  it('does not trigger 6m queries if 6m is already scouted', () => {
    const launchDate = new Date(Date.now() - 160 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones({
      brand: 'Samsung',
      model: 'Galaxy S24',
      launchDate,
      milestonesScouted: ['launch', '6m'],
    });

    expect(queries.some((q) => q.milestone === '6m')).toBe(false);
  });

  it('triggers 1y queries for a phone aged 350 days when 1y is not scouted', () => {
    const launchDate = new Date(Date.now() - 350 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones({
      brand: 'Apple',
      model: 'iPhone 15 Pro',
      launchDate,
      milestonesScouted: ['launch', '6m'],
    });

    expect(queries.some((q) => q.milestone === '1y')).toBe(true);
    expect(queries.some((q) => q.query.includes('1 year later'))).toBe(true);
    expect(queries.some((q) => q.temporalCategory === 'long_term_1y')).toBe(true);
  });

  it('triggers successor queries when a successor model is supplied', () => {
    const launchDate = new Date(Date.now() - 250 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones(
      {
        brand: 'Apple',
        model: 'iPhone 15 Pro',
        launchDate,
        milestonesScouted: ['launch', '6m'],
      },
      'iPhone 16 Pro',
    );

    expect(queries.some((q) => q.milestone === 'successor')).toBe(true);
    expect(queries.some((q) => q.query === 'iPhone 16 Pro vs iPhone 15 Pro')).toBe(true);
    expect(queries.some((q) => q.temporalCategory === 'comparison')).toBe(true);
  });

  it('omits successor queries when already scouted for that specific successor', () => {
    const launchDate = new Date(Date.now() - 250 * 24 * 60 * 60 * 1000);
    const queries = getDueMilestones(
      {
        brand: 'Apple',
        model: 'iPhone 15 Pro',
        launchDate,
        milestonesScouted: ['launch', '6m', 'successor:iPhone 16 Pro'],
      },
      'iPhone 16 Pro',
    );

    expect(queries.some((q) => q.milestone === 'successor')).toBe(false);
  });
});

/**
 * Tests for deterministic recommender requirement merging.
 *
 * These cover the failure mode where the LLM drops previously-known facts
 * during a short clarification answer.
 */
import { describe, expect, it } from 'vitest';

import type { UserRequirements } from './requirements-schema';
import {
  detectPlatformPreferenceFromRequirements,
  mergeUserRequirements,
  shouldResetRequirementState,
} from './requirements-merge';

function req(overrides: Partial<UserRequirements> = {}): UserRequirements {
  return {
    budget_usd: null,
    priorities: [],
    must_haves: [],
    deal_breakers: [],
    use_cases: [],
    form_factor: undefined,
    brand_preference: { liked: [], disliked: [] },
    confidence: 0.3,
    clarifying_question: undefined,
    ...overrides,
  };
}

describe('mergeUserRequirements', () => {
  it('keeps explicitly optional charging out of deterministic hard constraints', () => {
    const merged = mergeUserRequirements({
      previous: null,
      extracted: req(),
      userMessage: 'A phone under $600; fast charging would be nice to have',
    });
    expect(merged.must_haves).not.toContain('fast charging');
    const mixed = mergeUserRequirements({
      previous: null,
      extracted: req(),
      userMessage: 'NFC is required; fast charging is optional',
    });
    expect(mixed.must_haves).toEqual(['NFC']);
  });
  it('does not promote a negated camera need above newly stated priorities', () => {
    const merged = mergeUserRequirements({
      previous: req({
        budget_usd: { max: 700 },
        priorities: [{ aspect: 'camera', weight: 1 }],
        use_cases: ['camera'],
      }),
      extracted: req(),
      userMessage:
        "I don't take photos. Battery life and gaming performance are my main priorities now.",
    });
    expect(merged.priorities[0]?.aspect).toBe('performance');
    expect(merged.priorities.some((p) => p.aspect === 'camera')).toBe(false);
    expect(merged.budget_usd?.max).toBe(700);
  });
  it('preserves explicit exclusions even if the extractor omits them', () => {
    const merged = mergeUserRequirements({
      previous: req({ budget_usd: { max: 500 } }),
      extracted: req(),
      userMessage: 'Dealbreakers: I absolutely refuse anything with bloatware or slow charging.',
    });
    expect(merged.deal_breakers).toEqual(['bloatware', 'slow charging']);
  });
  it('allows explicit relaxation of unverifiable requirements while preserving platform and budget', () => {
    const previous = req({
      budget_usd: { max: 500 },
      must_haves: ['Android', 'fast charging'],
      deal_breakers: ['bloatware'],
    });
    const merged = mergeUserRequirements({
      previous,
      extracted: previous,
      userMessage: 'Please relax those conditions',
    });
    expect(merged.must_haves).toEqual(['Android']);
    expect(merged.deal_breakers).toEqual([]);
    expect(merged.budget_usd?.max).toBe(500);
  });
  it('recovers budget and camera priority when the LLM under-extracts an actionable first turn', () => {
    const merged = mergeUserRequirements({
      previous: null,
      extracted: req({ clarifying_question: 'Do you prefer Android or iPhone?' }),
      userMessage: 'Suggest me a phone under $1200 with great camera',
    });

    expect(merged.budget_usd?.max).toBe(1200);
    expect(merged.priorities[0]?.aspect).toBe('camera');
    expect(merged.use_cases).toContain('camera');
    expect(merged.clarifying_question).toBeUndefined();
  });

  it('preserves previous budget and camera when a short follow-up only adds Android', () => {
    const previous = req({
      budget_usd: { max: 1200 },
      priorities: [{ aspect: 'camera', weight: 1 }],
      use_cases: ['camera'],
      clarifying_question: 'Do you prefer Android or iPhone?',
    });

    const merged = mergeUserRequirements({
      previous,
      extracted: req({ must_haves: ['Android'], clarifying_question: 'What is your budget?' }),
      userMessage: 'I prefer Android',
    });

    expect(merged.budget_usd?.max).toBe(1200);
    expect(merged.priorities.some((p) => p.aspect === 'camera')).toBe(true);
    expect(merged.must_haves).toContain('Android');
    expect(merged.clarifying_question).toBeUndefined();
  });

  it('can clear a prior platform when the user says either Android or iPhone is fine', () => {
    const merged = mergeUserRequirements({
      previous: req({ must_haves: ['Android'] }),
      extracted: req(),
      userMessage: 'No preference between Android or iPhone, camera matters most under $900',
    });

    expect(detectPlatformPreferenceFromRequirements(merged)).toBeNull();
    expect(merged.must_haves.some((m) => /android|iphone|ios/i.test(m))).toBe(false);
  });

  it('does not carry old requirements into an explicit fresh start', () => {
    const merged = mergeUserRequirements({
      previous: req({
        budget_usd: { max: 1200 },
        priorities: [{ aspect: 'camera', weight: 1 }],
        must_haves: ['Android'],
        use_cases: ['camera'],
      }),
      extracted: req(),
      userMessage: 'Start over with something under $500 for battery life',
    });

    expect(shouldResetRequirementState('Start over with something under $500')).toBe(true);
    expect(merged.budget_usd?.max).toBe(500);
    expect(merged.priorities[0]?.aspect).toBe('battery');
    expect(merged.must_haves).not.toContain('Android');
  });

  it('treats standalone intake openers as a fresh query without inheriting prior platform constraints', () => {
    const previous = req({
      budget_usd: { max: 1200 },
      priorities: [{ aspect: 'performance', weight: 1 }],
      must_haves: ['Android'],
      use_cases: ['gaming'],
    });

    const userMessage =
      'Suggest me a phone under $1300 that has great camera and great battery life.';
    expect(shouldResetRequirementState(userMessage)).toBe(true);

    const merged = mergeUserRequirements({
      previous,
      extracted: req(),
      userMessage,
    });

    expect(merged.budget_usd?.max).toBe(1300);
    expect(merged.must_haves).not.toContain('Android');
    expect(detectPlatformPreferenceFromRequirements(merged)).toBeNull();
  });
});

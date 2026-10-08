import { describe, expect, it } from 'vitest';
import { blindedReviewSchema } from './campaign-artifacts';

describe('Independent review truth rubric', () => {
  const review = {
    reviewVersion: 2,
    runId: 'bc98cc8a-f3a6-4f96-838a-72c666179c5a',
    resultSha256: 'a'.repeat(64),
    corpusSha256: 'b'.repeat(64),
    reviewer: 'schema-test-only',
    reviewedAt: '2026-10-07T02:00:00.000Z',
    questions: [],
    answers: [
      {
        blindId: 'test',
        allClaimsSupported: 'yes',
        complete: 'yes',
        citationsCorrect: 'yes',
        phoneAttributionCorrect: 'yes',
        notes: '',
      },
    ],
  };
  it('requires factual correctness independently of citation support', () => {
    expect(blindedReviewSchema.safeParse(review).success).toBe(false);
    const result = blindedReviewSchema.parse({
      ...review,
      answers: [{ ...review.answers[0], allClaimsFactuallyCorrect: 'no' }],
    });
    expect(result.answers[0]?.allClaimsSupported).toBe('yes');
    expect(result.answers[0]?.allClaimsFactuallyCorrect).toBe('no');
  });
  it('rejects the old rubric and invented truth labels', () => {
    expect(blindedReviewSchema.safeParse({ ...review, reviewVersion: 1 }).success).toBe(false);
    expect(
      blindedReviewSchema.safeParse({
        ...review,
        answers: [{ ...review.answers[0], allClaimsFactuallyCorrect: 'probably' }],
      }).success,
    ).toBe(false);
  });
});

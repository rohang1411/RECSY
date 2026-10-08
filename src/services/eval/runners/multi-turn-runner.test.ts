import { describe, expect, it } from 'vitest';
import { immediateMutationResponsiveness } from './multi-turn-runner';

describe('immediateMutationResponsiveness', () => {
  it('does not invent a latency or score when no turn tests a mutation', () => {
    expect(
      immediateMutationResponsiveness([
        { mutationEligible: false, mutationResponsiveness: true },
        { mutationEligible: false, mutationResponsiveness: false },
      ]),
    ).toBeNull();
  });

  it('uses only eligible mutations in its denominator', () => {
    expect(
      immediateMutationResponsiveness([
        { mutationEligible: false, mutationResponsiveness: false },
        { mutationEligible: true, mutationResponsiveness: true },
        { mutationEligible: true, mutationResponsiveness: false },
      ]),
    ).toBe(0.5);
  });
});

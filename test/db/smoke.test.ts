import { describe, expect, it } from 'vitest';
import { isLocalDb } from './helpers';

describe('db test harness smoke', () => {
  it('reports database test harness availability', () => {
    expect(typeof isLocalDb()).toBe('boolean');
  });
});

import { describe, expect, it } from 'vitest';

import { hashContent } from './hashing';

describe('hashContent', () => {
  it('returns a 64-char lowercase hex string', () => {
    const h = hashContent('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'));
  });

  it('differs for different inputs', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'));
  });

  it('matches known sha256 for sanity', () => {
    // echo -n "abc" | sha256sum
    expect(hashContent('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

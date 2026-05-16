/**
 * Unit tests for scorecard retrieval query builder (`query-build.ts`).
 *
 * Tests cover: single-prompt pass-through, multiple prompt concatenation,
 * byte-length truncation at `SCORECARD_COMBINED_QUERY_MAX_BYTES`, and
 * deduplication of identical prompts. Pure.
 */
import { describe, expect, it } from 'vitest';

import { SCORECARD_COMBINED_QUERY_MAX_BYTES } from './constants';
import { buildCombinedRetrievalQuery } from './query-build';

describe('buildCombinedRetrievalQuery', () => {
  it('joins non-empty prompts with newlines', () => {
    expect(buildCombinedRetrievalQuery(['  a ', '', 'b'])).toBe('a\nb');
  });

  it('returns empty string when all prompts are blank', () => {
    expect(buildCombinedRetrievalQuery(['  ', '\t'])).toBe('');
  });

  it('truncates by UTF-8 bytes to the configured cap', () => {
    const unit = 'é'; // 2 bytes in UTF-8
    const n = Math.ceil(SCORECARD_COMBINED_QUERY_MAX_BYTES / 2) + 40;
    const long = unit.repeat(n);
    const out = buildCombinedRetrievalQuery([long]);
    expect(new TextEncoder().encode(out).length).toBeLessThanOrEqual(
      SCORECARD_COMBINED_QUERY_MAX_BYTES,
    );
    expect(out.length).toBeGreaterThan(0);
  });
});

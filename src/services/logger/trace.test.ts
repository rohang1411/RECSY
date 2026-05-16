/**
 * Unit tests for trace ID generation (`trace.ts`).
 *
 * Tests cover: output length (16 chars), hex-only characters, uniqueness
 * across repeated calls, and absence of UUID dashes. Pure.
 */
import { describe, expect, it } from 'vitest';

import { newTraceId } from './trace';

describe('newTraceId', () => {
  it('returns a 16-character string', () => {
    expect(newTraceId()).toHaveLength(16);
  });

  it('contains only hex characters', () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('contains no UUID dashes', () => {
    expect(newTraceId()).not.toContain('-');
  });

  it('returns different values on successive calls', () => {
    const ids = Array.from({ length: 20 }, () => newTraceId());
    const unique = new Set(ids);
    // 20 unique IDs from a 64-bit random space is virtually guaranteed
    expect(unique.size).toBe(20);
  });
});

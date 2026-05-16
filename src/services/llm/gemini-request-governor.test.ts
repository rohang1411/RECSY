/**
 * Unit tests for Gemini request governor (`gemini-request-governor.ts`).
 *
 * Tests cover: `profile='off'` always returns true immediately,
 * RPD exhaustion returns false, `estimateTokensFromMessages` token
 * estimation, `isLikelyGeminiQuotaExhaustedError` pattern matching,
 * and `GeminiRequestGovernor` acquireForKey / multi-key delegation.
 *
 * Real-time pacing tests (RPM/TPM window) are omitted here to avoid
 * slow tests; they would require `vi.useFakeTimers` with internal
 * timer advancement. Pure — no DB, no network.
 */
import { describe, expect, it } from 'vitest';

import {
  GeminiRequestGovernor,
  estimateTokensFromMessages,
  estimateTokensFromTexts,
  isLikelyGeminiQuotaExhaustedError,
  type GeminiGovernorOptions,
} from './gemini-request-governor';

const OFF_OPTS: GeminiGovernorOptions = {
  profile: 'off',
  rpm: 2,
  tpmInput: 32_000,
  rpd: 200,
};

const STRICT_OPTS: GeminiGovernorOptions = {
  profile: 'google_ai_studio_free',
  rpm: 15,
  tpmInput: 1_000_000,
  rpd: 1, // exhaust after one request
};

describe('estimateTokensFromMessages', () => {
  it('returns at least 1 for empty messages', () => {
    expect(estimateTokensFromMessages([])).toBeGreaterThanOrEqual(1);
  });

  it('returns a positive estimate for non-empty content', () => {
    const n = estimateTokensFromMessages([{ role: 'user', content: 'Hello, how are you?' }]);
    expect(n).toBeGreaterThan(1);
  });

  it('increases with longer content', () => {
    const short = estimateTokensFromMessages([{ role: 'user', content: 'Hi' }]);
    const long = estimateTokensFromMessages([{ role: 'user', content: 'A'.repeat(300) }]);
    expect(long).toBeGreaterThan(short);
  });
});

describe('estimateTokensFromTexts', () => {
  it('returns at least 1 for empty array', () => {
    expect(estimateTokensFromTexts([])).toBeGreaterThanOrEqual(1);
  });

  it('sums across multiple texts', () => {
    const single = estimateTokensFromTexts(['Hello world']);
    const double = estimateTokensFromTexts(['Hello world', 'Hello world']);
    expect(double).toBeGreaterThan(single);
  });
});

describe('GeminiRequestGovernor — profile=off', () => {
  it('always returns true without delay', async () => {
    const governor = new GeminiRequestGovernor(1, OFF_OPTS);
    const result = await governor.acquireForKey(0, 100);
    expect(result).toBe(true);
  });

  it('returns true for multiple rapid calls', async () => {
    const governor = new GeminiRequestGovernor(1, OFF_OPTS);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => governor.acquireForKey(0, i * 100)),
    );
    expect(results.every((r) => r)).toBe(true);
  });
});

describe('GeminiRequestGovernor — RPD exhaustion', () => {
  it('returns false when daily budget is exhausted', async () => {
    const governor = new GeminiRequestGovernor(1, STRICT_OPTS);
    // First call uses the budget
    const first = await governor.acquireForKey(0, 10);
    expect(first).toBe(true);
    // Second call finds RPD exhausted (rpd=1)
    const second = await governor.acquireForKey(0, 10);
    expect(second).toBe(false);
  });
});

describe('GeminiRequestGovernor — multi-key isolation', () => {
  it('key 0 and key 1 are independent', async () => {
    const governor = new GeminiRequestGovernor(2, STRICT_OPTS);
    // Exhaust key 0
    await governor.acquireForKey(0, 10);
    const key0Exhausted = await governor.acquireForKey(0, 10);
    expect(key0Exhausted).toBe(false);
    // Key 1 still has budget
    const key1 = await governor.acquireForKey(1, 10);
    expect(key1).toBe(true);
  });
});

describe('isLikelyGeminiQuotaExhaustedError', () => {
  it('detects RESOURCE_EXHAUSTED in message', () => {
    expect(isLikelyGeminiQuotaExhaustedError(new Error('RESOURCE_EXHAUSTED: quota'))).toBe(true);
  });

  it('detects 429 status code in message', () => {
    expect(isLikelyGeminiQuotaExhaustedError(new Error('status code 429'))).toBe(true);
  });

  it('detects "quota exceeded" phrase', () => {
    expect(isLikelyGeminiQuotaExhaustedError(new Error('You exceeded your current quota'))).toBe(
      true,
    );
  });

  it('detects AI_RetryError by name', () => {
    const err = new Error('retry');
    err.name = 'AI_RetryError';
    expect(isLikelyGeminiQuotaExhaustedError(err)).toBe(true);
  });

  it('detects all-keys exhausted wrappers and nested causes', () => {
    const cause = new Error('RESOURCE_EXHAUSTED');
    const err = new Error('Gemini API call failed (all configured API keys exhausted)', {
      cause,
    });
    expect(isLikelyGeminiQuotaExhaustedError(err)).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isLikelyGeminiQuotaExhaustedError(new Error('network timeout'))).toBe(false);
    expect(isLikelyGeminiQuotaExhaustedError(null)).toBe(false);
  });
});

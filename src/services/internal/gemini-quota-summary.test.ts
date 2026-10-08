import { describe, expect, it } from 'vitest';
import { summarizeVerifiedDailyQuota } from './gemini-quota-summary';
import type { GeminiQuotaFetchResult, GeminiQuotaRow } from './google-gemini-quota';

const row: GeminiQuotaRow = {
  projectId: 'p1',
  apiKeyIndex: 0,
  quotaMetric: 'free_requests',
  limitName: 'RequestsPerDay',
  model: 'flash',
  location: 'global',
  unit: 'day',
  limit: 20,
  used: 3,
  remaining: 17,
};
function quota(rows: GeminiQuotaRow[]): GeminiQuotaFetchResult {
  return { status: 'ok', rows, projects: [], fetchedAt: '', resetAt: '' };
}

describe('verified daily quota summary', () => {
  it('never substitutes configured local caps when Google has no quota rows', () => {
    expect(summarizeVerifiedDailyQuota(quota([]))).toEqual({
      limit: null,
      used: null,
      remaining: null,
    });
  });
  it('does not multiply project quota for multiple keys in the same project', () => {
    expect(summarizeVerifiedDailyQuota(quota([row, { ...row, apiKeyIndex: 1 }]))).toEqual({
      limit: 20,
      used: 3,
      remaining: 17,
    });
  });
  it('sums comparable project budgets without mixing token quotas', () => {
    expect(
      summarizeVerifiedDailyQuota(
        quota([
          row,
          { ...row, projectId: 'p2' },
          { ...row, quotaMetric: 'input_tokens', limitName: 'TokensPerDay', limit: 1000 },
        ]),
      ),
    ).toEqual({ limit: 40, used: 6, remaining: 34 });
  });
  it('does not combine different model budgets or pretend missing usage is known', () => {
    expect(
      summarizeVerifiedDailyQuota(quota([row, { ...row, model: 'pro' }])).remaining,
    ).toBeNull();
    expect(summarizeVerifiedDailyQuota(quota([{ ...row, used: null, remaining: null }]))).toEqual({
      limit: 20,
      used: null,
      remaining: null,
    });
  });
});

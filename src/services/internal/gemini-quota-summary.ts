import type { GeminiQuotaFetchResult } from './google-gemini-quota';

export function summarizeVerifiedDailyQuota(quota: GeminiQuotaFetchResult) {
  const unknown = { limit: null, used: null, remaining: null };
  if (quota.status !== 'ok') return unknown;
  const rows = quota.rows.filter(
    (row) =>
      row.unit === 'day' &&
      /request/i.test(`${row.quotaMetric} ${row.limitName}`) &&
      !/token/i.test(`${row.quotaMetric} ${row.limitName}`),
  );
  const signature = (row: (typeof rows)[number]) =>
    JSON.stringify([row.quotaMetric, row.limitName, row.model, row.location]);
  // Different model budgets aren't interchangeable; same-project keys share one quota.
  if (rows.length === 0 || new Set(rows.map(signature)).size !== 1) return unknown;
  const unique = [
    ...new Map(rows.map((row) => [`${row.projectId}:${signature(row)}`, row])).values(),
  ];
  const sum = (field: 'limit' | 'used' | 'remaining'): number | null => {
    const values = unique.map((row) => row[field]);
    return values.every(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    )
      ? values.reduce((total, value) => total + value, 0)
      : null;
  };
  return { limit: sum('limit'), used: sum('used'), remaining: sum('remaining') };
}

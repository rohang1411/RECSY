import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

import { env } from '@/env';

type ServiceAccount = {
  readonly client_email: string;
  readonly private_key: string;
  readonly token_uri?: string;
};

type TimeSeriesPoint = {
  readonly interval?: { readonly endTime?: string };
  readonly value?: { readonly int64Value?: string; readonly doubleValue?: number };
};

type TimeSeries = {
  readonly metric?: { readonly labels?: Record<string, string> };
  readonly resource?: { readonly labels?: Record<string, string> };
  readonly points?: readonly TimeSeriesPoint[];
};

type TimeSeriesResponse = {
  readonly timeSeries?: readonly TimeSeries[];
  readonly nextPageToken?: string;
};

export type GeminiQuotaProject = {
  readonly projectId: string;
  readonly apiKeyIndex: number;
};

export type GeminiQuotaRow = {
  readonly projectId: string;
  readonly apiKeyIndex: number;
  readonly quotaMetric: string;
  readonly limitName: string;
  readonly model: string | null;
  readonly location: string | null;
  readonly unit: 'day' | 'minute' | 'other';
  readonly limit: number | null;
  readonly used: number | null;
  readonly remaining: number | null;
};

export type GeminiQuotaFetchResult =
  | {
      readonly status: 'ok';
      readonly fetchedAt: string;
      readonly resetAt: string;
      readonly projects: readonly GeminiQuotaProject[];
      readonly message?: string;
      readonly rows: readonly GeminiQuotaRow[];
    }
  | {
      readonly status: 'not_configured' | 'error';
      readonly fetchedAt: string;
      readonly resetAt: string;
      readonly projects: readonly GeminiQuotaProject[];
      readonly message: string;
      readonly rows: readonly GeminiQuotaRow[];
    };

let tokenCache: { readonly token: string; readonly expiresAtMs: number } | null = null;

export function getConfiguredGeminiQuotaProjects(): readonly GeminiQuotaProject[] {
  return (env.GOOGLE_CLOUD_QUOTA_PROJECT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((projectId, index) => ({ projectId, apiKeyIndex: index }));
}

export function getConfiguredGeminiKeyCount(): number {
  return [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4,
  ].filter((value) => typeof value === 'string' && value.length > 0).length;
}

export async function fetchGeminiQuotaFromGoogle(): Promise<GeminiQuotaFetchResult> {
  const fetchedAt = new Date();
  const resetAt = nextPacificMidnight(fetchedAt);
  const projects = getConfiguredGeminiQuotaProjects();

  if (projects.length === 0) {
    return {
      status: 'not_configured',
      fetchedAt: fetchedAt.toISOString(),
      resetAt: resetAt.toISOString(),
      projects,
      message: 'Set GOOGLE_CLOUD_QUOTA_PROJECT_IDS to fetch verified Gemini quota rows.',
      rows: [],
    };
  }

  try {
    const token = await getAccessToken();
    const startOfDay = startOfPacificDay(fetchedAt);
    const results = await Promise.all(
      projects.map(async (project) => {
        try {
          return {
            project,
            rows: await fetchProjectQuota(project, token, startOfDay, fetchedAt),
            error: null,
          };
        } catch (err) {
          return {
            project,
            rows: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    const rows = results.flatMap((result) => result.rows);
    const errors = results
      .filter((result) => result.error)
      .map((result) => `${result.project.projectId}: ${briefQuotaError(result.error ?? '')}`);
    if (rows.length === 0 && errors.length > 0) {
      throw new Error(errors.join(' | '));
    }
    return {
      status: 'ok',
      fetchedAt: fetchedAt.toISOString(),
      resetAt: resetAt.toISOString(),
      projects,
      message: errors.length > 0 ? `Partial quota fetch: ${errors.join(' | ')}` : undefined,
      rows,
    };
  } catch (err) {
    return {
      status: 'error',
      fetchedAt: fetchedAt.toISOString(),
      resetAt: resetAt.toISOString(),
      projects,
      message: err instanceof Error ? err.message : String(err),
      rows: [],
    };
  }
}

function briefQuotaError(message: string): string {
  if (
    message.includes('Cloud Monitoring API has not been used') ||
    message.includes('it is disabled')
  ) {
    return 'Cloud Monitoring API is disabled or not initialized.';
  }
  if (message.includes('Permission denied') || message.includes('"code": 403')) {
    return 'Service account lacks Cloud Monitoring permission.';
  }
  return message.replace(/\s+/g, ' ').slice(0, 180);
}

async function fetchProjectQuota(
  project: GeminiQuotaProject,
  token: string,
  start: Date,
  end: Date,
): Promise<readonly GeminiQuotaRow[]> {
  const [limitSeries, usageSeries] = await Promise.all([
    fetchTimeSeries(
      project.projectId,
      token,
      'serviceruntime.googleapis.com/quota/limit',
      start,
      end,
    ),
    fetchTimeSeries(
      project.projectId,
      token,
      'serviceruntime.googleapis.com/quota/rate/net_usage',
      start,
      end,
    ),
  ]);

  const usageByKey = new Map<string, number>();
  for (const series of usageSeries) {
    const labels = collectLabels(series);
    const metric = labels.quota_metric ?? '';
    if (!isGeminiQuotaMetric(metric)) continue;
    const key = rowKey(labels);
    usageByKey.set(key, (usageByKey.get(key) ?? 0) + sumPoints(series.points));
  }

  return limitSeries
    .map((series) => collectLabels(series))
    .filter((labels) => isGeminiQuotaMetric(labels.quota_metric ?? ''))
    .map((labels) => {
      const limit = latestPointValue(
        limitSeries.find((series) => rowKey(collectLabels(series)) === rowKey(labels))?.points,
      );
      const used = usageByKey.get(rowKey(labels)) ?? null;
      const remaining = limit !== null && used !== null ? Math.max(0, limit - used) : null;
      return {
        projectId: project.projectId,
        apiKeyIndex: project.apiKeyIndex,
        quotaMetric: labels.quota_metric ?? 'unknown',
        limitName: labels.limit_name ?? 'Quota',
        model: labels.model ?? null,
        location: labels.location ?? null,
        unit: classifyUnit(labels.limit_name ?? '', labels.quota_metric ?? ''),
        limit,
        used,
        remaining,
      } satisfies GeminiQuotaRow;
    })
    .sort((a, b) => `${a.projectId}:${a.limitName}`.localeCompare(`${b.projectId}:${b.limitName}`));
}

async function fetchTimeSeries(
  projectId: string,
  token: string,
  metricType: string,
  start: Date,
  end: Date,
): Promise<readonly TimeSeries[]> {
  const filter = [
    'resource.type = "consumer_quota"',
    'resource.labels.service = "generativelanguage.googleapis.com"',
    `metric.type = "${metricType}"`,
  ].join(' AND ');
  const base = new URL(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries`);
  base.searchParams.set('filter', filter);
  base.searchParams.set('interval.startTime', start.toISOString());
  base.searchParams.set('interval.endTime', end.toISOString());
  base.searchParams.set('view', 'FULL');
  base.searchParams.set('pageSize', '200');

  const rows: TimeSeries[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(base);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Google Monitoring ${metricType} failed for ${projectId}: ${res.status} ${body.slice(0, 220)}`,
      );
    }
    const json = (await res.json()) as TimeSeriesResponse;
    rows.push(...(json.timeSeries ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);

  return rows;
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs - 60_000 > now) return tokenCache.token;

  const account = await loadServiceAccount();
  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const assertion = [
    base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
    base64url(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/cloud-platform',
        aud: account.token_uri ?? 'https://oauth2.googleapis.com/token',
        iat,
        exp,
      }),
    ),
  ].join('.');
  const signature = createSign('RSA-SHA256').update(assertion).sign(account.private_key);
  const jwt = `${assertion}.${base64url(signature)}`;

  const res = await fetch(account.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(4_000),
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok)
    throw new Error(`Google OAuth token request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token)
    throw new Error('Google OAuth token response did not include access_token.');
  tokenCache = { token: json.access_token, expiresAtMs: now + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

async function loadServiceAccount(): Promise<ServiceAccount> {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      return parseServiceAccount(await readFile(env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
    } catch (err) {
      throw new Error(
        `Could not read GOOGLE_APPLICATION_CREDENTIALS service-account JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    return parseServiceAccount(await readServiceAccountJsonValue(raw));
  }

  throw new Error(
    'Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS for Google quota fetch.',
  );
}

async function readServiceAccountJsonValue(raw: string): Promise<string> {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;

  if (looksLikeJsonFilePath(trimmed)) {
    try {
      return await readFile(trimmed, 'utf8');
    } catch {
      // Fall through to base64 decoding so genuine base64 values still work.
    }
  }

  try {
    return Buffer.from(trimmed, 'base64').toString('utf8');
  } catch (err) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON must be raw JSON or base64 JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function looksLikeJsonFilePath(value: string): boolean {
  return (
    value.toLowerCase().endsWith('.json') ||
    /^[a-z]:[\\/]/i.test(value) ||
    value.startsWith('/') ||
    value.startsWith('~')
  );
}

function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(raw) as Partial<ServiceAccount>;
  } catch (err) {
    throw new Error(
      `Service account credential is not valid JSON. Use the downloaded Google service-account key file path in GOOGLE_APPLICATION_CREDENTIALS, or paste the JSON/base64 JSON into GOOGLE_SERVICE_ACCOUNT_JSON. ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Google service account JSON must include client_email and private_key.');
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri,
  };
}

function collectLabels(series: TimeSeries): Record<string, string> {
  return { ...(series.resource?.labels ?? {}), ...(series.metric?.labels ?? {}) };
}

function rowKey(labels: Record<string, string>): string {
  return [
    labels.quota_metric ?? '',
    labels.limit_name ?? '',
    labels.model ?? '',
    labels.location ?? '',
  ].join('|');
}

function isGeminiQuotaMetric(metric: string): boolean {
  return metric.startsWith('generativelanguage.googleapis.com/');
}

function sumPoints(points: readonly TimeSeriesPoint[] | undefined): number {
  return (points ?? []).reduce((sum, point) => sum + pointValue(point), 0);
}

function latestPointValue(points: readonly TimeSeriesPoint[] | undefined): number | null {
  const [latest] = [...(points ?? [])].sort((a, b) =>
    String(b.interval?.endTime ?? '').localeCompare(String(a.interval?.endTime ?? '')),
  );
  return latest ? pointValue(latest) : null;
}

function pointValue(point: TimeSeriesPoint): number {
  const raw = point.value?.int64Value ?? point.value?.doubleValue ?? 0;
  return typeof raw === 'string' ? Number(raw) : raw;
}

function classifyUnit(limitName: string, metric: string): GeminiQuotaRow['unit'] {
  const text = `${limitName} ${metric}`.toLowerCase();
  if (text.includes('perday') || text.includes('per day') || text.includes('requestsperday'))
    return 'day';
  if (text.includes('perminute') || text.includes('per minute') || text.includes('tokensperminute'))
    return 'minute';
  return 'other';
}

function startOfPacificDay(date: Date): Date {
  const parts = datePartsInPacific(date);
  const offset = offsetMinutes('America/Los_Angeles', date);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) - offset * 60_000);
}

function nextPacificMidnight(date: Date): Date {
  const start = startOfPacificDay(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function datePartsInPacific(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

function offsetMinutes(timeZone: string, date: Date): number {
  const value = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = value?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return -480;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

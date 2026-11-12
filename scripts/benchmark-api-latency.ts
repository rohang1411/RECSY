/**
 * Benchmark harness for RECSY API latency and stage breakdown.
 *
 * Enforces Rule R8:
 * - Refuses to run unless DATABASE_URL is loopback/docker and LLM_PROVIDER=controlled.
 * - Seeds nothing itself (run `pnpm db:setup` and `pnpm ci:retrieval-fixture` beforehand).
 * - Targets BENCH_BASE_URL (default http://127.0.0.1:3000).
 *
 * Measures scenarios across concurrency levels (1, 5, 20) with 100 requests each
 * (or --quick for a 5-request smoke test).
 *
 * Normative reference: Plan 26 WP-00 Step 6.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export function parseServerTiming(header: string | null): Record<string, number> {
  const result: Record<string, number> = {};
  if (!header) return result;
  const entries = header.split(',');
  for (const entry of entries) {
    const parts = entry.trim().split(';');
    const name = parts[0]?.trim();
    if (!name) continue;
    for (const p of parts.slice(1)) {
      const [k, v] = p.trim().split('=');
      if (k === 'dur' && v) {
        const num = parseFloat(v);
        if (!isNaN(num)) {
          result[name] = num;
        }
      }
    }
  }
  return result;
}

export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * q) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))] ?? 0;
}

export function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function assertSafeBenchmarkEnvironment(): void {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required for benchmark harness');
  }
  let hostname = '';
  try {
    hostname = new URL(dbUrl).hostname;
  } catch {
    throw new Error('Invalid DATABASE_URL');
  }
  const allowedHosts = ['localhost', '127.0.0.1', '::1', 'postgres', 'db', 'host.docker.internal'];
  if (!allowedHosts.includes(hostname)) {
    throw new Error(
      `DATABASE_URL host "${hostname}" is not a safe local target. Benchmark requires local database (Rule R8).`,
    );
  }

  const llmProvider = process.env.LLM_PROVIDER;
  if (llmProvider !== 'controlled') {
    throw new Error(
      `LLM_PROVIDER must be 'controlled' (got '${llmProvider}'). Enforces deterministic zero-cost benchmark (Rule R8).`,
    );
  }
}

export interface RequestMetric {
  readonly status: number;
  readonly totalMs: number;
  readonly ttfvtMs?: number;
  readonly stages: Record<string, number>;
}

export interface ScenarioResult {
  readonly scenario: string;
  readonly concurrency: number;
  readonly requestCount: number;
  readonly errorCount: number;
  readonly totalP50: number;
  readonly totalP90: number;
  readonly totalP95: number;
  readonly totalP99: number;
  readonly ttfvtP50?: number;
  readonly ttfvtP90?: number;
  readonly ttfvtP95?: number;
  readonly ttfvtP99?: number;
  readonly stageP50: Record<string, number>;
  readonly stageP95: Record<string, number>;
}

async function executeScenarioRequest(
  baseUrl: string,
  scenario: string,
  reqIndex: number,
  operatorToken?: string,
): Promise<RequestMetric> {
  const t0 = performance.now();
  const operatorHeaders: Record<string, string> = operatorToken
    ? { 'x-operator-token': operatorToken }
    : {};

  if (scenario === 'anon-ask-warm' || scenario === 'anon-ask-cold') {
    const slug = 'apple-iphone-16-pro';
    const query =
      scenario === 'anon-ask-warm'
        ? 'How is the battery life on iPhone 16 Pro?'
        : `Battery inquiry variant ${reqIndex} for iPhone 16 Pro`;

    const res = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...operatorHeaders,
      },
      body: JSON.stringify({ phoneSlug: slug, query }),
    });

    let ttfvtMs: number | undefined;
    const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
    const stageFromDone: Record<string, number> = {};

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'delta' && ttfvtMs === undefined) {
              ttfvtMs = Math.round(performance.now() - t0);
            } else if (parsed.type === 'done' && parsed.stages) {
              Object.assign(stageFromDone, parsed.stages);
            }
          } catch {
            // ignore non-json line
          }
        }
      }
    }

    const totalMs = Math.round(performance.now() - t0);
    return {
      status: res.status,
      totalMs,
      ttfvtMs,
      stages: { ...stageFromDone, ...serverTiming },
    };
  }

  if (scenario === 'signed-in-ask') {
    const res = await fetch(`${baseUrl}/api/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: 'recsy_fake_uid=bench-user-12345678',
        ...operatorHeaders,
      },
      body: JSON.stringify({
        phoneSlug: 'apple-iphone-16-pro',
        query: `Signed in query ${reqIndex}`,
      }),
    });

    let ttfvtMs: number | undefined;
    const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
    const stageFromDone: Record<string, number> = {};

    if (res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'delta' && ttfvtMs === undefined) {
              ttfvtMs = Math.round(performance.now() - t0);
            } else if (parsed.type === 'done' && parsed.stages) {
              Object.assign(stageFromDone, parsed.stages);
            }
          } catch {}
        }
      }
    }

    const totalMs = Math.round(performance.now() - t0);
    return {
      status: res.status,
      totalMs,
      ttfvtMs,
      stages: { ...stageFromDone, ...serverTiming },
    };
  }

  if (scenario === 'recommend-clarify') {
    const res = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...operatorHeaders,
      },
      body: JSON.stringify({ message: 'phone' }),
    });
    await res.text();
    const totalMs = Math.round(performance.now() - t0);
    const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
    return {
      status: res.status,
      totalMs,
      ttfvtMs: totalMs,
      stages: serverTiming,
    };
  }

  if (scenario === 'recommend-results') {
    const res = await fetch(`${baseUrl}/api/recommend`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...operatorHeaders,
      },
      body: JSON.stringify({
        message: 'Looking for a flagship phone under $900 with great battery and camera',
      }),
    });
    await res.text();
    const totalMs = Math.round(performance.now() - t0);
    const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
    return {
      status: res.status,
      totalMs,
      ttfvtMs: totalMs,
      stages: serverTiming,
    };
  }

  if (scenario === 'phone-page') {
    const res = await fetch(`${baseUrl}/p/apple-iphone-16-pro`, {
      headers: operatorHeaders,
    });
    await res.text();
    const totalMs = Math.round(performance.now() - t0);
    const serverTiming = parseServerTiming(res.headers.get('Server-Timing'));
    return {
      status: res.status,
      totalMs,
      stages: serverTiming,
    };
  }

  if (scenario === 'browse-default') {
    const res = await fetch(`${baseUrl}/browse`, {
      headers: operatorHeaders,
    });
    await res.text();
    const totalMs = Math.round(performance.now() - t0);
    return {
      status: res.status,
      totalMs,
      stages: parseServerTiming(res.headers.get('Server-Timing')),
    };
  }

  if (scenario === 'browse-brand') {
    const res = await fetch(`${baseUrl}/browse?brand=Apple&sort=price-asc`, {
      headers: operatorHeaders,
    });
    await res.text();
    const totalMs = Math.round(performance.now() - t0);
    return {
      status: res.status,
      totalMs,
      stages: parseServerTiming(res.headers.get('Server-Timing')),
    };
  }

  if (scenario === 'browse-price-range') {
    const res = await fetch(`${baseUrl}/browse?minPrice=500&maxPrice=1000&sort=latest`, {
      headers: operatorHeaders,
    });
    await res.text();
    const totalMs = Math.round(performance.now() - t0);
    return {
      status: res.status,
      totalMs,
      stages: parseServerTiming(res.headers.get('Server-Timing')),
    };
  }

  throw new Error(`Unknown scenario: ${scenario}`);
}

async function runScenarioBatch(
  baseUrl: string,
  scenario: string,
  concurrency: number,
  totalRequests: number,
  operatorToken?: string,
): Promise<ScenarioResult> {
  const metrics: RequestMetric[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < totalRequests) {
      const idx = nextIndex++;
      try {
        const metric = await executeScenarioRequest(baseUrl, scenario, idx, operatorToken);
        metrics.push(metric);
      } catch (_err) {
        metrics.push({
          status: 500,
          totalMs: 0,
          stages: {},
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, totalRequests) }, () => worker());
  await Promise.all(workers);

  const totals = metrics.filter((m) => m.status < 400).map((m) => m.totalMs);
  const ttfvts = metrics.filter((m) => m.ttfvtMs !== undefined).map((m) => m.ttfvtMs!);
  const errors = metrics.filter((m) => m.status >= 400).length;

  const stageKeys = new Set<string>();
  for (const m of metrics) {
    for (const k of Object.keys(m.stages)) {
      stageKeys.add(k);
    }
  }

  const stageP50: Record<string, number> = {};
  const stageP95: Record<string, number> = {};
  for (const k of stageKeys) {
    const vals = metrics.map((m) => m.stages[k] ?? 0).filter((v) => v > 0);
    if (vals.length > 0) {
      stageP50[k] = Math.round(percentile(vals, 0.5));
      stageP95[k] = Math.round(percentile(vals, 0.95));
    }
  }

  return {
    scenario,
    concurrency,
    requestCount: metrics.length,
    errorCount: errors,
    totalP50: Math.round(percentile(totals, 0.5)),
    totalP90: Math.round(percentile(totals, 0.9)),
    totalP95: Math.round(percentile(totals, 0.95)),
    totalP99: Math.round(percentile(totals, 0.99)),
    ...(ttfvts.length > 0
      ? {
          ttfvtP50: Math.round(percentile(ttfvts, 0.5)),
          ttfvtP90: Math.round(percentile(ttfvts, 0.9)),
          ttfvtP95: Math.round(percentile(ttfvts, 0.95)),
          ttfvtP99: Math.round(percentile(ttfvts, 0.99)),
        }
      : {}),
    stageP50,
    stageP95,
  };
}

export async function runBenchmark() {
  assertSafeBenchmarkEnvironment();

  const baseUrl = process.env.BENCH_BASE_URL ?? 'http://127.0.0.1:3000';
  const operatorToken = process.env.INTERNAL_OPERATOR_TOKEN || process.env.INTERNAL_EVAL_TOKEN;
  const isQuick = process.argv.includes('--quick');

  const concurrencyLevels = isQuick ? [1] : [1, 5, 20];
  const requestsPerScenario = isQuick ? 5 : 100;

  const scenarios = [
    'anon-ask-warm',
    'anon-ask-cold',
    'recommend-clarify',
    'recommend-results',
    'phone-page',
    'browse-default',
    'browse-brand',
    'browse-price-range',
  ];

  console.log(`Starting RECSY API Latency Benchmark on ${baseUrl}`);
  console.log(`Concurrency levels: ${concurrencyLevels.join(', ')}`);
  console.log(`Requests per scenario: ${requestsPerScenario}`);

  const results: ScenarioResult[] = [];

  for (const c of concurrencyLevels) {
    for (const sc of scenarios) {
      process.stdout.write(`Benchmarking ${sc} (c=${c})... `);
      const res = await runScenarioBatch(baseUrl, sc, c, requestsPerScenario, operatorToken);
      results.push(res);
      console.log(`p50=${res.totalP50}ms, p95=${res.totalP95}ms, errors=${res.errorCount}`);
    }
  }

  const gitSha = getGitSha();
  const outputDir = resolve(process.cwd(), 'fixtures/benchmarks');
  await mkdir(outputDir, { recursive: true });
  const jsonPath = resolve(outputDir, `api-latency-${gitSha}.json`);
  await writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Saved raw benchmark results to ${jsonPath}`);

  // Format Markdown table to stdout
  console.log('\n### Benchmark Summary Table (ms)\n');
  console.log(
    '| Scenario | Concurrency | p50 | p90 | p95 | p99 | TTFVT p50 | TTFVT p95 | Top Stages (p50) |',
  );
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  for (const r of results) {
    const topStages = Object.entries(r.stageP50)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([k, v]) => `${k}:${v}ms`)
      .join(', ');

    console.log(
      `| ${r.scenario} | ${r.concurrency} | ${r.totalP50} | ${r.totalP90} | ${r.totalP95} | ${r.totalP99} | ${r.ttfvtP50 ?? '-'} | ${r.ttfvtP95 ?? '-'} | ${topStages || '-'} |`,
    );
  }
}

if (process.argv[1]?.endsWith('benchmark-api-latency.ts')) {
  runBenchmark().catch((err) => {
    console.error('Benchmark failed:', err);
    process.exit(1);
  });
}

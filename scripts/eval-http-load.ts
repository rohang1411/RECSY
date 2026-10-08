import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  if (!/^eval_[a-z0-9_]+$/.test(stage.namespace)) throw new Error('Invalid isolated schema');
  const base = process.env.EVAL_HTTP_URL ?? 'http://127.0.0.1:3100';
  if (new URL(base).hostname !== '127.0.0.1')
    throw new Error('Load campaign requires loopback staging');
  const token = process.env.EVAL_CONTROLLED_PROVIDER_TOKEN;
  const getSourceFiles = () =>
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(
        (p) =>
          p.startsWith('src/') ||
          p.startsWith('drizzle/') ||
          p.startsWith('fixtures/') ||
          p.startsWith('scripts/') ||
          ['package.json', 'pnpm-lock.yaml', 'next.config.ts'].includes(p),
      )
      .sort();
  const sourceFiles = getSourceFiles();
  let sourceIntegrity: { passed: boolean | null; changedFiles: string[] } = {
    passed: null,
    changedFiles: [],
  };
  const sourceHashes: Record<string, string> = {};
  for (const path of sourceFiles.sort())
    sourceHashes[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
  const sourceSha256 = createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex');
  const status = await fetch('http://127.0.0.1:3210/status', {
    headers: { 'x-eval-token': token ?? '' },
  });
  if (!status.ok || (await status.json()).mode !== 'normal')
    throw new Error('Controlled provider must be healthy before load');
  const smoke = process.argv.includes('--quick');
  const phases = smoke
    ? [{ name: 'smoke', seconds: 10, rps: 1 }]
    : [
        { name: 'baseline', seconds: 60, rps: 1 },
        { name: 'sustained', seconds: 180, rps: 2 },
        { name: 'spike', seconds: 15, rps: 8 },
        { name: 'recovery', seconds: 60, rps: 1 },
        { name: 'soak', seconds: 180, rps: 1 },
      ];
  const rows: Array<Record<string, unknown>> = [];
  const summaries: Array<Record<string, unknown>> = [];
  let inflight = 0;
  let requestIndex = 0;
  const maxInflight = 20;
  const phones = [
    'apple-iphone-16-pro',
    'google-pixel-9',
    'oneplus-13',
    'google-pixel-9-pro',
    'apple-iphone-16',
    'samsung-galaxy-s25-ultra',
  ];
  const queries = ['battery', 'camera', 'display', 'charging', 'software', 'thermal performance'];
  const start = performance.now();
  const percentile = (values: number[], q: number) =>
    values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * q) - 1] : null;
  const dir = resolve(stage.outputDir, 'http');
  await mkdir(dir, { recursive: true });
  const path = resolve(dir, `${Date.now()}-load.json`);
  const save = () =>
    writeFile(
      path,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          schema: stage.namespace,
          base,
          sourceSha256,
          sourceHashes,
          sourceIntegrity,
          environment: 'Next.js development server, logical schema on shared database host',
          provider: 'controlled-test-no-quality',
          productionCapacityClaim: false,
          arrivalModel: 'open scheduled arrivals',
          maxInflight,
          queryEmbeddingCache: 'warm after repeated queries; no response cache',
          slo: { p95Ms: 3000, errorRateMaximum: 0.01, droppedMaximum: 0 },
          phases: summaries,
          requests: rows,
          elapsedMs: performance.now() - start,
        },
        null,
        2,
      ),
    );
  process.once('SIGINT', () => {
    save().then(() => process.exit(130));
  });
  // Check the actual app provider, not only the controller process.
  const warm = await fetch(`${base}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.18.255.1' },
    body: JSON.stringify({ phoneSlug: phones[0], query: 'battery' }),
    signal: AbortSignal.timeout(30000),
  });
  const warmEvents = (await warm.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  if (!warmEvents.some((e) => e.type === 'done' && e.model === 'controlled-test-no-quality'))
    throw new Error('App is not running the controlled provider; load aborted');
  for (const phase of phases) {
    const phaseStart = performance.now();
    const phaseRows: Array<Record<string, unknown>> = [];
    const pending: Promise<void>[] = [];
    const offered = phase.seconds * phase.rps;
    for (let i = 0; i < offered; i++) {
      const due = phaseStart + (i * 1000) / phase.rps;
      await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
      const index = requestIndex++;
      const plannedOffsetMs = due - start;
      if (inflight >= maxInflight) {
        const row = {
          phase: phase.name,
          index,
          plannedOffsetMs,
          status: 'dropped',
          reason: 'max in-flight exceeded',
        };
        rows.push(row);
        phaseRows.push(row);
        continue;
      }
      inflight++;
      pending.push(
        (async () => {
          const requestStart = performance.now();
          let row: Record<string, unknown>;
          const ask = index % 4 !== 0;
          const route = ask ? '/api/ask' : '/api/recommend';
          try {
            const response = await fetch(base + route, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-forwarded-for': `198.18.${Math.floor(index / 250) % 250}.${(index % 250) + 1}`,
              },
              body: JSON.stringify(
                ask
                  ? {
                      phoneSlug: phones[index % phones.length],
                      query: queries[index % queries.length],
                    }
                  : {
                      message: [
                        'Android under $700 with good battery',
                        'Camera phone under $1000',
                        'Compact phone under $800',
                      ][index % 3],
                    },
              ),
              signal: AbortSignal.timeout(15000),
            });
            const raw = await response.text();
            const data = ask
              ? raw
                  .trim()
                  .split('\n')
                  .filter(Boolean)
                  .map((line) => JSON.parse(line))
              : JSON.parse(raw);
            const terminal = ask ? data.at(-1) : data;
            const success =
              response.ok &&
              (ask
                ? terminal?.type === 'done' &&
                  terminal.model === 'controlled-test-no-quality' &&
                  !terminal.retrievalTrace?.degradedStages?.length &&
                  !data.some((e: { type: string }) => e.type === 'error')
                : ['results', 'clarify'].includes(data.kind));
            const trace = ask ? terminal?.retrievalTrace : undefined;
            row = {
              phase: phase.name,
              index,
              route,
              plannedOffsetMs,
              schedulingLagMs: requestStart - due,
              status: success ? 'successful' : 'failed',
              httpStatus: response.status,
              code: terminal?.code ?? null,
              traceId: response.headers.get('x-trace-id'),
              latencyMs: performance.now() - requestStart,
              retrievalMs: terminal?.retrievalMs,
              stages: trace?.stages,
              chunkCount: trace?.chunkCount,
              persistenceMs: terminal?.persistenceMs,
            };
          } catch (error) {
            row = {
              phase: phase.name,
              index,
              route,
              plannedOffsetMs,
              schedulingLagMs: requestStart - due,
              status: 'failed',
              latencyMs: performance.now() - requestStart,
              error: error instanceof Error ? error.message : String(error),
            };
          }
          rows.push(row);
          phaseRows.push(row);
          inflight--;
        })(),
      );
    }
    await Promise.all(pending);
    const elapsedMs = performance.now() - phaseStart;
    const started = phaseRows.filter((r) => r.status !== 'dropped');
    const successful = phaseRows.filter((r) => r.status === 'successful');
    const failed = phaseRows.filter((r) => r.status === 'failed');
    const dropped = offered - started.length;
    const latencies = started.map((r) => Number(r.latencyMs));
    const p95 = percentile(latencies, 0.95);
    const summary = {
      ...phase,
      offered,
      started: started.length,
      dropped,
      completed: started.length,
      successful: successful.length,
      failed: failed.length,
      elapsedMs,
      goodput: successful.length / (elapsedMs / 1000),
      errorRate: failed.length / started.length,
      p50Ms: percentile(latencies, 0.5),
      p95Ms: p95,
      p99Ms: percentile(latencies, 0.99),
      maxSchedulingLagMs: Math.max(...started.map((r) => Number(r.schedulingLagMs))),
      objectivePassed:
        dropped === 0 && failed.length / started.length <= 0.01 && Number(p95) <= 3000,
    };
    summaries.push(summary);
    await save();
    console.log(JSON.stringify(summary));
  }
  const finalFiles = getSourceFiles();
  const changedFiles = [];
  for (const file of new Set([...sourceFiles, ...finalFiles])) {
    const finalHash = finalFiles.includes(file)
      ? createHash('sha256')
          .update(await readFile(file))
          .digest('hex')
      : null;
    if (sourceHashes[file] !== finalHash) changedFiles.push(file);
  }
  sourceIntegrity = { passed: changedFiles.length === 0, changedFiles };
  await save();
  console.log(`Artifact: ${path}`);
  if (!sourceIntegrity.passed || summaries.some((p) => !p.objectivePassed)) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

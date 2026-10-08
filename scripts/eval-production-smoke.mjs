import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
if (
  !/^eval_[a-z0-9_]+$/.test(stage.namespace) ||
  resolve(stage.outputDir) !== resolve('output/eval', stage.namespace)
)
  throw new Error('Production smoke requires the current isolated stage');
await mkdir(resolve(stage.outputDir, 'logs'), { recursive: true });
const stamp = Date.now();
const rows = [];
for (const enabled of [true, false]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () =>
      reject(new Error('Loopback port 3110 is occupied; no production smoke requests started')),
    );
    probe.listen(3110, '127.0.0.1', () => probe.close(() => resolve()));
  });
  const token = randomUUID();
  const child = spawn(
    process.execPath,
    [
      '--env-file=.env.local',
      resolve('node_modules/next/dist/bin/next'),
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3110',
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_SCHEMA: stage.namespace,
        INTERNAL_DASHBOARD_ENABLED: String(enabled),
        INTERNAL_EVAL_TOKEN: token,
        LLM_PROVIDER: 'gemini',
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const log = createWriteStream(
    resolve(stage.outputDir, 'logs', `${stamp}-production-${enabled}.log`),
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Production server exited; inspect log');
      try {
        if (
          (await fetch('http://127.0.0.1:3110/recommend', { signal: AbortSignal.timeout(500) })).ok
        ) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error('Production server startup timed out');
    const cases = enabled
      ? [
          ['eval-no-token', '/api/internal/eval/runs', {}, 401],
          [
            'eval-invalid-token',
            '/api/internal/eval/runs',
            { headers: { 'x-recsy-eval-token': 'incorrect' } },
            401,
          ],
          [
            'eval-valid-token',
            '/api/internal/eval/runs',
            { headers: { 'x-recsy-eval-token': token } },
            200,
          ],
          [
            'campaign-artifacts-production-denied',
            '/api/internal/eval/campaign',
            { headers: { 'x-recsy-eval-token': token } },
            404,
          ],
          [
            'malformed-recommend',
            '/api/recommend',
            { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{broken' },
            400,
          ],
          [
            'unknown-phone',
            '/api/ask',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ phoneSlug: 'not-a-real-phone', query: 'battery' }),
            },
            404,
          ],
        ]
      : [
          [
            'disabled-eval',
            '/api/internal/eval/runs',
            { headers: { 'x-recsy-eval-token': token } },
            404,
          ],
        ];
    for (const [name, path, options, expected] of cases) {
      const response = await fetch('http://127.0.0.1:3110' + path, {
        ...options,
        signal: AbortSignal.timeout(15000),
      });
      await response.text();
      rows.push({
        name,
        expected,
        actual: response.status,
        passed: response.status === expected,
        traceId: response.headers.get('x-trace-id'),
      });
    }
  } finally {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      child.kill();
    }
    await new Promise((r) => {
      if (child.exitCode !== null) r();
      else child.once('exit', r);
    });
    log.end();
  }
}
await writeFile(
  resolve(stage.outputDir, `${stamp}-production-build-http-smoke.json`),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      environment: 'local production build, isolated schema, no generation requests',
      rows,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify(rows, null, 2));
if (rows.some((r) => !r.passed)) process.exitCode = 1;

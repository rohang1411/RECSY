import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';

async function main() {
  const children: ChildProcess[] = [];
  const flags = new Set(process.argv.slice(2));
  const tsx = resolve('node_modules/tsx/dist/cli.mjs');
  const run = async (
    script: string,
    extra: string[] = [],
    environment: NodeJS.ProcessEnv = process.env,
  ) => {
    console.log(`Starting ${script}`);
    const child = spawn(
      process.execPath,
      [tsx, '--env-file=.env.local', resolve('scripts', script), ...extra],
      { env: environment, stdio: 'inherit', windowsHide: true },
    );
    children.push(child);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    if (code !== 0)
      throw new Error(
        `${script} failed with exit ${code}. Inspect its per-case artifact and error before rerunning.`,
      );
  };
  if (flags.has('--new-stage')) await run('eval-stage.ts');
  const stage = JSON.parse(
    await readFile('output/eval/current-stage.json', 'utf8').catch(() => {
      throw new Error(
        'No isolated stage. Run pnpm eval:campaign --new-stage once; this creates a separate schema and snapshots catalog/corpus.',
      );
    }),
  );
  if (!/^eval_[a-z0-9_]+$/.test(stage.namespace)) throw new Error('Invalid staging schema');
  for (const port of [3100, 3210])
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () =>
        reject(
          new Error(
            `Loopback port ${port} is occupied. Stop its owner or choose a separate evaluation session; no tests or provider calls started.`,
          ),
        ),
      );
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
    });
  await mkdir(resolve(stage.outputDir, 'logs'), { recursive: true });
  const environment = {
    ...process.env,
    NODE_ENV: 'development' as const,
    DATABASE_SCHEMA: stage.namespace,
    LLM_PROVIDER: 'controlled',
    LLM_CACHE_ENABLED: 'false',
    EVAL_CONTROLLED_PROVIDER_URL: 'http://127.0.0.1:3210',
    EVAL_CONTROLLED_PROVIDER_TOKEN: randomUUID(),
    EVAL_HTTP_URL: 'http://127.0.0.1:3100',
  };
  const start = (name: string, args: string[]) => {
    const child = spawn(process.execPath, args, {
      env: environment,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    const log = createWriteStream(resolve(stage.outputDir, 'logs', `${Date.now()}-${name}.log`));
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    child.once('error', (error) => console.error(`${name}: ${error.message}`));
    return child;
  };
  const stop = () => {
    for (const child of children)
      if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') {
          try {
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
          } catch {
            child.kill();
          }
        } else child.kill();
      }
  };
  process.once('SIGINT', () => {
    stop();
    process.exitCode = 130;
  });
  process.once('SIGTERM', stop);
  try {
    const provider = start('provider', [
      tsx,
      '--env-file=.env.local',
      resolve('scripts/eval-controlled-server.ts'),
    ]);
    const app = start('app', [
      resolve('node_modules/next/dist/bin/next'),
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ]);
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      if (provider.exitCode !== null || app.exitCode !== null)
        throw new Error(
          'Evaluation server exited during startup. Inspect the app/provider log files; check port availability and environment validation.',
        );
      try {
        const controller = await fetch('http://127.0.0.1:3210/status', {
          headers: { 'x-eval-token': environment.EVAL_CONTROLLED_PROVIDER_TOKEN },
          signal: AbortSignal.timeout(1000),
        });
        const route = await fetch('http://127.0.0.1:3100/recommend', {
          signal: AbortSignal.timeout(3000),
        });
        if (controller.ok && route.ok) {
          ready = true;
          break;
        }
      } catch {
        /* bounded startup retry */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready)
      throw new Error(
        'Servers did not become ready within 60 seconds; inspect stage/logs. No load or live model calls were made.',
      );
    console.log(`Isolated portal: http://127.0.0.1:3100/internal/eval (schema ${stage.namespace})`);
    if (flags.has('--serve-only')) {
      await new Promise<void>((r) => app.once('exit', () => r()));
      return;
    }
    await run('eval-corpus.ts', [], environment);
    await run('eval-http.ts', [], environment);
    const trackErrors: unknown[] = [];
    if (flags.has('--load')) {
      try {
        await run('eval-http-load.ts', flags.has('--quick') ? ['--quick'] : [], environment);
      } catch (error) {
        trackErrors.push(error);
      }
    }
    if (flags.has('--live')) {
      let qualityError: unknown;
      try {
        await run(
          'eval-quality.ts',
          ['--live', ...(flags.has('--after-quota-reset') ? ['--after-quota-reset'] : [])],
          { ...environment, LLM_PROVIDER: 'gemini' },
        );
      } catch (error) {
        qualityError = error;
      }
      await run('eval-review.ts', [], environment);
      if (qualityError) trackErrors.push(qualityError);
    }
    console.log(
      `Campaign artifacts: ${stage.outputDir}. Controlled results cannot establish live answer quality or production capacity.`,
    );
    if (trackErrors.length)
      throw new Error(
        trackErrors.map((e) => (e instanceof Error ? e.message : String(e))).join('\n'),
      );
  } finally {
    stop();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

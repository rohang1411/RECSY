import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
if (
  !/^eval_[a-z0-9_]+$/.test(stage.namespace) ||
  resolve(stage.outputDir) !== resolve('output/eval', stage.namespace)
)
  throw new Error('Portal smoke requires the current isolated campaign');
await mkdir(resolve(stage.outputDir, 'logs'), { recursive: true });
const stamp = Date.now();
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/tsx/dist/cli.mjs'),
    '--env-file=.env.local',
    resolve('scripts/eval-campaign.ts'),
    '--serve-only',
  ],
  {
    env: { ...process.env, INTERNAL_DASHBOARD_ENABLED: 'true' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
const log = createWriteStream(resolve(stage.outputDir, 'logs', `${stamp}-portal-smoke.log`));
child.stdout.pipe(log);
child.stderr.pipe(log);
let browser;
const checks = [];
const check = (name, condition) => {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(`Portal verification failed: ${name}`);
};
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error('Portal server exited; inspect stage/logs');
    try {
      if (
        (await fetch('http://127.0.0.1:3100/internal/eval', { signal: AbortSignal.timeout(1000) }))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  check('isolated portal starts', ready);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:3100/internal/eval');
  await page.getByRole('button', { name: 'Load campaign evidence', exact: true }).click();
  const results = page.getByLabel('Campaign results');
  await results.waitFor({ state: 'visible' });
  check(
    'readiness and incomplete pilot are visible',
    (await results.textContent()).includes('Resume answer-quality percentage: unavailable'),
  );
  check(
    'offered load and generator drops are visible',
    (await results.textContent()).includes('Generator drops'),
  );
  check(
    'stage diagnostics are visible',
    (await results.textContent()).includes('Largest observed stage'),
  );
  await results.screenshot({ path: resolve(stage.outputDir, `${stamp}-portal-campaign.png`) });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download blinded review', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs(resolve(stage.outputDir, `${stamp}-downloaded-review.html`));
  check(
    'review package downloads',
    (await readFile(resolve(stage.outputDir, `${stamp}-downloaded-review.html`), 'utf8')).includes(
      'RECSY independent blinded review',
    ),
  );
  await page.goto('http://127.0.0.1:3100/api/internal/eval/campaign?artifact=review');
  await page.getByRole('button', { name: 'Export review JSON', exact: true }).click();
  check(
    'missing labels produce an inline review error',
    (await page.getByRole('alert').textContent()).includes('complete all selections'),
  );
  const invalid = await fetch('http://127.0.0.1:3100/api/internal/eval/campaign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const invalidBody = await invalid.json();
  check(
    'invalid review import is rejected with its cause',
    invalid.status === 422 &&
      typeof invalidBody.error === 'string' &&
      invalidBody.error.includes('ZodError'),
  );
} finally {
  await browser?.close();
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } catch {
    child.kill();
  }
  log.end();
  await writeFile(
    resolve(stage.outputDir, `${stamp}-portal-smoke.json`),
    JSON.stringify({ at: new Date().toISOString(), checks, humanReviewCreated: false }, null, 2),
  );
  console.log(JSON.stringify(checks, null, 2));
}

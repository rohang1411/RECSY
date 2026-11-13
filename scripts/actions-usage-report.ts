import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GitHubWorkflowRun {
  id: number;
  workflow_id?: number;
  name?: string;
  head_sha?: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at?: string;
  run_started_at?: string;
  html_url?: string;
}

export interface WorkflowJob {
  id?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface WorkflowRunSummary {
  id: number;
  name: string;
  workflowId: number;
  workflowFile: string;
  event: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  runStartedAt: string;
  updatedAt: string;
  htmlUrl: string;
  headSha: string;
  jobs: WorkflowJob[];
  billedMinutes: number;
  durationSeconds: number;
  cronSlot?: string | null;
  scheduleDelayMinutes?: number | null;
}

export interface WorkflowReport {
  workflowFile: string;
  workflowName: string;
  cronExpr: string | null;
  totalRuns: number;
  runsByEvent: Record<string, number>;
  runsByConclusion: Record<string, number>;
  scheduledRuns: {
    count: number;
    medianGapHours: number | null;
    medianDelayMinutes: number | null;
    p90DelayMinutes: number | null;
  };
  billedMinutes: {
    total: number;
    medianPerRun: number;
    p90PerRun: number;
    meanPerRun: number;
    maxPerRun: number;
    extrapolatedPerMonth: number;
  };
  sampleRuns: Array<{
    id: number;
    event: string;
    conclusion: string | null;
    runStartedAt: string;
    billedMinutes: number;
    delayMinutes: number | null;
  }>;
}

export function matchCronField(field: string, value: number): boolean {
  if (field === '*') return true;
  if (field.includes(',')) {
    return field.split(',').some((sub) => matchCronField(sub.trim(), value));
  }
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }
  if (field.includes('-')) {
    const segments = field.split('-');
    const startStr = segments[0];
    const endStr = segments[1];
    if (startStr !== undefined && endStr !== undefined) {
      const start = parseInt(startStr.trim(), 10);
      const end = parseInt(endStr.trim(), 10);
      return !isNaN(start) && !isNaN(end) && value >= start && value <= end;
    }
    return false;
  }
  const num = parseInt(field, 10);
  return !isNaN(num) && num === value;
}

export function matchesCron(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const minField = parts[0];
  const hourField = parts[1];
  const domField = parts[2];
  const monthField = parts[3];
  const dowField = parts[4];
  if (!minField || !hourField || !domField || !monthField || !dowField) return false;

  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfMonth = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dayOfWeek = date.getUTCDay();

  if (!matchCronField(minField, minute)) return false;
  if (!matchCronField(hourField, hour)) return false;
  if (!matchCronField(domField, dayOfMonth)) return false;
  if (!matchCronField(monthField, month)) return false;
  if (!matchCronField(dowField, dayOfWeek)) return false;

  return true;
}

export function findPrecedingCronSlot(cron: string, targetDate: Date): Date | null {
  const d = new Date(
    Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate(),
      targetDate.getUTCHours(),
      targetDate.getUTCMinutes(),
      0,
      0,
    ),
  );
  // Search backward up to 8 days in 1-minute steps
  const maxMinutes = 8 * 24 * 60;
  for (let i = 0; i <= maxMinutes; i++) {
    const checkDate = new Date(d.getTime() - i * 60_000);
    if (matchesCron(cron, checkDate)) {
      return checkDate;
    }
  }
  return null;
}

export function calculateJobBilledMinutes(job: WorkflowJob): number {
  if (job.conclusion === 'skipped') return 0;
  if (!job.started_at || !job.completed_at) return 0;
  const start = new Date(job.started_at).getTime();
  const end = new Date(job.completed_at).getTime();
  const durationMs = end - start;
  if (durationMs <= 0) return 0;
  return Math.max(1, Math.ceil(durationMs / 60_000));
}

export function calculateRunBilledMinutes(jobs: WorkflowJob[]): number {
  if (!jobs || jobs.length === 0) return 0;
  return jobs.reduce((sum, job) => sum + calculateJobBilledMinutes(job), 0);
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  const clampedIndex = Math.max(0, Math.min(index, sorted.length - 1));
  const val = sorted[clampedIndex];
  return val !== undefined ? val : 0;
}

export function calculateMedianGapHours(isoTimestamps: string[]): number | null {
  if (isoTimestamps.length < 2) return null;
  const sortedMs = [...isoTimestamps].map((ts) => new Date(ts).getTime()).sort((a, b) => a - b);
  const gapsHours: number[] = [];
  for (let i = 1; i < sortedMs.length; i++) {
    const curr = sortedMs[i];
    const prev = sortedMs[i - 1];
    if (curr !== undefined && prev !== undefined) {
      const gapH = (curr - prev) / (1000 * 3600);
      gapsHours.push(gapH);
    }
  }
  return percentile(gapsHours, 50);
}

export function calculateScheduleDelayMinutes(
  cronExpr: string | null,
  runStartedAt: string,
): number | null {
  if (!cronExpr) return null;
  const started = new Date(runStartedAt);
  if (isNaN(started.getTime())) return null;
  const slot = findPrecedingCronSlot(cronExpr, started);
  if (!slot) return null;
  const delayMs = started.getTime() - slot.getTime();
  return Math.max(0, Math.round(delayMs / 60_000));
}

export function getGitHubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    const credential = execFileSync(
      'git',
      ['-c', 'credential.interactive=false', 'credential', 'fill'],
      {
        input: 'protocol=https\nhost=github.com\n\n',
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    const token = credential
      .split(/\r?\n/)
      .find((line) => line.startsWith('password='))
      ?.slice('password='.length);
    if (token) return token;
  } catch {
    // ignore
  }
  throw new Error('No GitHub credential available via env or git credential fill.');
}

export function getRepoSlug(): string {
  try {
    const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }).trim();
    const match = remoteUrl.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/);
    if (match && match[1]) return match[1];
  } catch {
    // fallback
  }
  return 'rohang1411/RECSY';
}

export function extractCronFromWorkflow(fileContent: string): string | null {
  const match = fileContent.match(/cron:\s*['"]([^'"]+)['"]/);
  return match && match[1] ? match[1] : null;
}

export function extractWorkflowName(fileContent: string, fallback: string): string {
  const match = fileContent.match(/^name:\s*(.+)$/m);
  if (match && match[1]) {
    return match[1].trim().replace(/^['"]|['"]$/g, '');
  }
  return fallback;
}

export async function createGitHubClient(token: string, repo: string) {
  async function get(apiPath: string) {
    const url = `https://api.github.com/repos/${repo}/${apiPath}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'RECSY-actions-usage-report',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      throw new Error(`GitHub GET ${apiPath.split('?')[0]} failed: HTTP ${res.status}`);
    }
    return res.json();
  }
  return { get };
}

export function generateMarkdownReport(
  reports: WorkflowReport[],
  observationDays: number,
  isProvisional: boolean,
): string {
  const totalBilled = reports.reduce((s, r) => s + r.billedMinutes.total, 0);
  const totalExtrapolated = reports.reduce((s, r) => s + r.billedMinutes.extrapolatedPerMonth, 0);
  const totalRuns = reports.reduce((s, r) => s + r.totalRuns, 0);

  const lines: string[] = [
    `# GitHub Actions Usage & Cost Baseline Report`,
    ``,
    `> **Report Date:** ${new Date().toISOString().split('T')[0]}  `,
    `> **Observation Window:** Last ${observationDays} days  `,
    `> **Baseline Status:** ${isProvisional ? '⚠️ **Provisional** (post-PR-82 green run accumulation in progress)' : '✅ **Verified Baseline**'}  `,
    `> **Accounting Model:** Per GitHub Actions billing specification: each non-skipped job duration is rounded up to the next integer minute. Actual billed minutes on a public repository are $0, but this report measures true execution consumption as if private.`,
    ``,
    `---`,
    ``,
    `## 1. Executive Summary`,
    ``,
    `| Metric | Measured Value |`,
    `| :--- | :--- |`,
    `| **Total Workflow Runs Analyzed** | **${totalRuns.toLocaleString()}** |`,
    `| **Measured Billed Minutes (${observationDays}d Window)** | **${totalBilled.toLocaleString()} min** |`,
    `| **Extrapolated Billed Minutes / Month (30d)** | **${totalExtrapolated.toLocaleString()} min/mo** |`,
    `| **Nominal Unconstrained Baseline (Plan 30 v1.0.0)** | 17,326 min/mo |`,
    ``,
    `---`,
    ``,
    `## 2. Per-Workflow Measured Baseline`,
    ``,
    `| Workflow | Cron | Runs | Sched Runs | Median Gap | Sched Delay (p50 / p90) | Billed/Run (p50 / p90) | Total Mins | Extrapolated min/mo |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const r of reports) {
    const cron = r.cronExpr ? `\`${r.cronExpr}\`` : '—';
    const gap =
      r.scheduledRuns.medianGapHours !== null
        ? `${r.scheduledRuns.medianGapHours.toFixed(1)} h`
        : '—';
    const delay =
      r.scheduledRuns.count > 0 && r.scheduledRuns.medianDelayMinutes !== null
        ? `${r.scheduledRuns.medianDelayMinutes}m / ${r.scheduledRuns.p90DelayMinutes ?? r.scheduledRuns.medianDelayMinutes}m`
        : '—';
    const billedRun = `${r.billedMinutes.medianPerRun}m / ${r.billedMinutes.p90PerRun}m`;

    lines.push(
      `| \`${r.workflowFile}\` | ${cron} | ${r.totalRuns} | ${r.scheduledRuns.count} | ${gap} | ${delay} | ${billedRun} | ${r.billedMinutes.total} | ${r.billedMinutes.extrapolatedPerMonth} |`,
    );
  }

  lines.push(
    `| **Total / Summary** | — | **${totalRuns}** | — | — | — | — | **${totalBilled}** | **${totalExtrapolated}** |`,
  );
  lines.push(``);
  lines.push(`---`);
  lines.push(``);
  lines.push(`## 3. Workflow Details & Conclusions`);
  lines.push(``);

  for (const r of reports) {
    lines.push(`### \`${r.workflowFile}\` (${r.workflowName})`);
    lines.push(
      `- **Schedule:** ${r.cronExpr ? `\`${r.cronExpr}\`` : 'None (Manual or Event-driven)'}`,
    );
    lines.push(`- **Total Runs in Window:** ${r.totalRuns}`);
    lines.push(
      `- **Events:** ${
        Object.entries(r.runsByEvent)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'None'
      }`,
    );
    lines.push(
      `- **Conclusions:** ${
        Object.entries(r.runsByConclusion)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ') || 'None'
      }`,
    );
    if (r.scheduledRuns.count > 0) {
      lines.push(
        `- **Scheduled Delivery:** ${r.scheduledRuns.count} runs, median gap between runs: ${r.scheduledRuns.medianGapHours?.toFixed(1) ?? 'N/A'} h`,
      );
      lines.push(
        `- **Schedule Delay from Slot:** median ${r.scheduledRuns.medianDelayMinutes ?? 0} min, p90 ${r.scheduledRuns.p90DelayMinutes ?? 0} min`,
      );
    }
    lines.push(
      `- **Billed Minutes:** median ${r.billedMinutes.medianPerRun}m, p90 ${r.billedMinutes.p90PerRun}m, mean ${r.billedMinutes.meanPerRun.toFixed(1)}m, max ${r.billedMinutes.maxPerRun}m`,
    );
    lines.push(
      `- **Extrapolated Monthly Consumption:** ${r.billedMinutes.extrapolatedPerMonth.toLocaleString()} min/mo`,
    );
    lines.push(``);
  }

  return lines.join('\n');
}

export async function runActionsUsageReport(options?: {
  days?: number;
  outputMarkdown?: string;
  outputJson?: string;
}) {
  const days = options?.days ?? 14;
  const token = getGitHubToken();
  const repo = getRepoSlug();
  const client = await createGitHubClient(token, repo);

  const workflowsDir = path.resolve('.github/workflows');
  const workflowFiles = fs
    .readdirSync(workflowsDir)
    .filter((f) => f.endsWith('.yml'))
    .sort();

  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 3600 * 1000);

  const reports: WorkflowReport[] = [];

  for (const file of workflowFiles) {
    const fullPath = path.join(workflowsDir, file);
    const content = fs.readFileSync(fullPath, 'utf8');
    const cron = extractCronFromWorkflow(content);
    const name = extractWorkflowName(content, file);

    process.stdout.write(`Fetching runs for ${file}... `);

    const runs: GitHubWorkflowRun[] = [];
    try {
      let page = 1;
      let hasMore = true;
      while (hasMore && page <= 5) {
        const resp = (await client.get(
          `actions/workflows/${encodeURIComponent(file)}/runs?per_page=100&page=${page}`,
        )) as { workflow_runs?: GitHubWorkflowRun[] };
        const fetchedRuns = resp.workflow_runs ?? [];
        if (fetchedRuns.length === 0) break;
        for (const run of fetchedRuns) {
          const runDate = new Date(run.created_at);
          if (runDate >= cutoff) {
            runs.push(run);
          } else {
            hasMore = false;
            break;
          }
        }
        if (fetchedRuns.length < 100) hasMore = false;
        page++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`(Failed to fetch runs: ${msg})`);
    }

    const runsByEvent: Record<string, number> = {};
    const runsByConclusion: Record<string, number> = {};
    const scheduledTimestamps: string[] = [];
    const scheduledDelays: number[] = [];
    const runBilledMinutesList: number[] = [];
    const sampleRuns: WorkflowReport['sampleRuns'] = [];

    for (const run of runs) {
      runsByEvent[run.event] = (runsByEvent[run.event] ?? 0) + 1;
      const conclusionKey = run.conclusion ?? run.status ?? 'unknown';
      runsByConclusion[conclusionKey] = (runsByConclusion[conclusionKey] ?? 0) + 1;

      let jobs: WorkflowJob[] = [];
      try {
        const jobsResp = await client.get(`actions/runs/${run.id}/jobs?per_page=100`);
        jobs = jobsResp.jobs ?? [];
      } catch {
        // fallback
      }

      const billed = calculateRunBilledMinutes(jobs);
      runBilledMinutesList.push(billed);

      let delay: number | null = null;
      if (run.event === 'schedule' && cron) {
        scheduledTimestamps.push(run.run_started_at || run.created_at);
        delay = calculateScheduleDelayMinutes(cron, run.run_started_at || run.created_at);
        if (delay !== null) {
          scheduledDelays.push(delay);
        }
      }

      if (sampleRuns.length < 5) {
        sampleRuns.push({
          id: run.id,
          event: run.event,
          conclusion: run.conclusion,
          runStartedAt: run.run_started_at || run.created_at,
          billedMinutes: billed,
          delayMinutes: delay,
        });
      }
    }

    const totalRuns = runs.length;
    const scheduledCount = scheduledTimestamps.length;
    const medianGapHours = calculateMedianGapHours(scheduledTimestamps);
    const medianDelayMinutes = scheduledDelays.length > 0 ? percentile(scheduledDelays, 50) : null;
    const p90DelayMinutes = scheduledDelays.length > 0 ? percentile(scheduledDelays, 90) : null;

    const totalBilled = runBilledMinutesList.reduce((s, v) => s + v, 0);
    const medianBilled = percentile(runBilledMinutesList, 50);
    const p90Billed = percentile(runBilledMinutesList, 90);
    const maxBilled = runBilledMinutesList.length > 0 ? Math.max(...runBilledMinutesList) : 0;
    const meanBilled = totalRuns > 0 ? totalBilled / totalRuns : 0;
    const extrapolatedPerMonth = Math.round((totalBilled / days) * 30);

    reports.push({
      workflowFile: file,
      workflowName: name,
      cronExpr: cron,
      totalRuns,
      runsByEvent,
      runsByConclusion,
      scheduledRuns: {
        count: scheduledCount,
        medianGapHours,
        medianDelayMinutes,
        p90DelayMinutes,
      },
      billedMinutes: {
        total: totalBilled,
        medianPerRun: medianBilled,
        p90PerRun: p90Billed,
        meanPerRun: meanBilled,
        maxPerRun: maxBilled,
        extrapolatedPerMonth,
      },
      sampleRuns,
    });

    console.log(`done (${totalRuns} runs, ${totalBilled} min).`);
  }

  const isProvisional = true; // Still within 14 days of PR #82
  const md = generateMarkdownReport(reports, days, isProvisional);

  const outMdPath = path.resolve(
    options?.outputMarkdown ?? 'docs/Reports/05_ACTIONS_USAGE_BASELINE.md',
  );
  fs.mkdirSync(path.dirname(outMdPath), { recursive: true });
  fs.writeFileSync(outMdPath, md, 'utf8');
  console.log(`\nMarkdown report written to: ${outMdPath}`);

  if (options?.outputJson) {
    const outJsonPath = path.resolve(options.outputJson);
    fs.mkdirSync(path.dirname(outJsonPath), { recursive: true });
    fs.writeFileSync(outJsonPath, JSON.stringify(reports, null, 2), 'utf8');
    console.log(`JSON report written to: ${outJsonPath}`);
  }

  return { reports, markdown: md };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('actions-usage-report.ts')) {
  runActionsUsageReport({
    days: 14,
    outputMarkdown: 'docs/Reports/05_ACTIONS_USAGE_BASELINE.md',
    outputJson: 'docs/Reports/05_ACTIONS_USAGE_BASELINE.json',
  }).catch((err) => {
    console.error('Fatal error running actions usage report:', err);
    process.exit(1);
  });
}

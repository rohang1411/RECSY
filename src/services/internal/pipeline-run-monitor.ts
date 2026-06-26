import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type AppDb } from '@/services/db/client';
import {
  catalogCandidates,
  catalogQualityIssues,
  catalogRuns,
  crawlQueue,
  ingestRuns,
  phones,
  scorecardRuns,
} from '@/services/db/schema';

export type PipelineRunDetail = {
  readonly label: string;
  readonly value: string;
  readonly tone?: 'default' | 'good' | 'warn' | 'bad';
};

export type PipelineRunRelatedItem = {
  readonly title: string;
  readonly status: string;
  readonly detail: string;
  readonly meta?: string;
  readonly href?: string | null;
};

export type PipelineRunRow = {
  readonly id: string;
  readonly label: string;
  readonly status: string;
  readonly detail: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly details: readonly PipelineRunDetail[];
  readonly related: readonly PipelineRunRelatedItem[];
  readonly diagnostics: readonly string[];
};

export type PipelineRunMonitorData = {
  readonly ingestionRuns: readonly PipelineRunRow[];
  readonly scorecardRuns: readonly PipelineRunRow[];
  readonly resumeRows: readonly PipelineRunRow[];
  readonly catalogRefreshRuns: readonly PipelineRunRow[];
  readonly githubRuns: readonly PipelineRunRow[];
};

type CatalogCandidateRow = {
  readonly id: string;
  readonly runId: string | null;
  readonly title: string;
  readonly status: string;
  readonly decision: string | null;
  readonly sourceKey: string;
  readonly sourceType: string;
  readonly sourceUrl: string | null;
  readonly confidence: string | null;
  readonly issueCodes: readonly string[];
  readonly lastError: string | null;
  readonly retryAfter: Date | null;
  readonly matchedBrand: string | null;
  readonly matchedModel: string | null;
  readonly matchedSlug: string | null;
};

type CatalogIssueRow = {
  readonly runId: string | null;
  readonly candidateId: string | null;
  readonly severity: string;
  readonly code: string;
  readonly message: string;
  readonly fieldPath: string | null;
  readonly sourceKey: string | null;
};

export async function loadPipelineRunMonitorData(): Promise<PipelineRunMonitorData> {
  const db = getDb();

  const [ingestionRuns, scoreRuns, resumeRows, catalogRunRows, githubRuns] = await Promise.all([
    loadRecentIngestionRuns(db),
    loadRecentScorecardRuns(db),
    loadResumeQueueRows(db),
    loadCatalogRunRows(db),
    loadGithubWorkflowRuns(),
  ]);

  return {
    ingestionRuns,
    scorecardRuns: scoreRuns,
    resumeRows,
    catalogRefreshRuns: catalogRunRows,
    githubRuns,
  };
}

type GithubWorkflowRun = {
  readonly id: number;
  readonly name: string | null;
  readonly path: string;
  readonly display_title: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly event: string;
  readonly html_url: string;
  readonly run_number: number;
  readonly run_attempt: number;
  readonly run_started_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly head_branch: string | null;
  readonly head_sha: string;
  readonly jobs_url: string;
};

type GithubWorkflowRunsResponse = {
  readonly total_count?: number;
  readonly workflow_runs?: readonly GithubWorkflowRun[];
};

type GithubJob = {
  readonly name: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly html_url: string;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly steps?: readonly {
    readonly name: string;
    readonly status: string;
    readonly conclusion: string | null;
    readonly number: number;
  }[];
};

type GithubJobsResponse = {
  readonly jobs?: readonly GithubJob[];
};

const GITHUB_REPO = 'rohang1411/RECSY';
const GITHUB_API_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'RECSY-internal-pipeline',
  'X-GitHub-Api-Version': '2022-11-28',
} as const;

async function loadGithubWorkflowRuns(): Promise<readonly PipelineRunRow[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/runs?per_page=20`,
      {
        headers: GITHUB_API_HEADERS,
        signal: controller.signal,
        next: { revalidate: 120 },
      },
    );
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`GitHub workflow run fetch failed: ${response.status}`);
    }
    const payload = (await response.json()) as GithubWorkflowRunsResponse;
    const runs = payload.workflow_runs ?? [];
    const jobDetails = await Promise.all(runs.slice(0, 8).map((run) => loadGithubJobs(run)));
    const jobsByRun = new Map(jobDetails.map((item) => [item.runId, item.jobs]));

    return runs.map((run) => githubRunToRow(run, jobsByRun.get(run.id) ?? []));
  } catch (error) {
    console.error('GitHub workflow history fetch failed:', error);
    return [];
  }
}

async function loadGithubJobs(
  run: GithubWorkflowRun,
): Promise<{ readonly runId: number; readonly jobs: readonly GithubJob[] }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(run.jobs_url, {
      headers: GITHUB_API_HEADERS,
      signal: controller.signal,
      next: { revalidate: 120 },
    });
    clearTimeout(timer);
    if (!response.ok) return { runId: run.id, jobs: [] };
    const payload = (await response.json()) as GithubJobsResponse;
    return { runId: run.id, jobs: payload.jobs ?? [] };
  } catch {
    return { runId: run.id, jobs: [] };
  }
}

function githubRunToRow(run: GithubWorkflowRun, jobs: readonly GithubJob[]): PipelineRunRow {
  const status = run.conclusion ?? run.status;
  const failedJobs = jobs.filter((job) => job.conclusion && job.conclusion !== 'success');
  const failedSteps = failedJobs.flatMap((job) =>
    (job.steps ?? [])
      .filter((step) => step.conclusion && step.conclusion !== 'success')
      .map((step) => `${job.name}: ${step.name} (${step.conclusion})`),
  );

  return {
    id: `github-${run.id}`,
    label: `${run.name ?? workflowNameFromPath(run.path)} #${run.run_number}`,
    status,
    detail: run.display_title,
    startedAt: formatIsoDate(run.run_started_at ?? run.created_at),
    finishedAt: formatIsoDate(run.updated_at),
    details: [
      { label: 'Workflow', value: workflowNameFromPath(run.path) },
      { label: 'Event', value: run.event },
      { label: 'Branch', value: run.head_branch ?? 'unknown' },
      { label: 'Attempt', value: String(run.run_attempt) },
      { label: 'Commit', value: run.head_sha.slice(0, 7) },
      { label: 'Jobs', value: String(jobs.length) },
      {
        label: 'Failed jobs',
        value: String(failedJobs.length),
        tone: failedJobs.length > 0 ? 'bad' : 'good',
      },
    ],
    related:
      jobs.length > 0
        ? jobs.slice(0, 10).map((job) => ({
            title: job.name,
            status: job.conclusion ?? job.status,
            detail: jobTimeSummary(job),
            href: job.html_url,
          }))
        : [
            {
              title: run.display_title,
              status,
              detail: `Workflow file: ${run.path}`,
              href: run.html_url,
            },
          ],
    diagnostics:
      failedSteps.length > 0
        ? failedSteps.slice(0, 8)
        : failedJobs.length > 0
          ? failedJobs.map((job) => `${job.name}: ${job.conclusion}`)
          : [`GitHub Actions status: ${status}. Open the run for full logs.`],
  };
}

async function loadRecentIngestionRuns(db: AppDb): Promise<readonly PipelineRunRow[]> {
  const rows = await optionalQuery(
    db
      .select({
        id: ingestRuns.id,
        adapter: ingestRuns.adapter,
        status: ingestRuns.status,
        chunksCreated: ingestRuns.chunksCreated,
        tier: ingestRuns.tier,
        stage: ingestRuns.stage,
        errorCode: ingestRuns.errorCode,
        sourceUrl: ingestRuns.sourceUrl,
        rejectedReason: ingestRuns.rejectedReason,
        candidateTitle: ingestRuns.candidateTitle,
        startedAt: ingestRuns.startedAt,
        finishedAt: ingestRuns.finishedAt,
        durationMs: ingestRuns.durationMs,
        error: ingestRuns.error,
        phoneBrand: phones.brand,
        phoneModel: phones.model,
        phoneSlug: phones.slug,
      })
      .from(ingestRuns)
      .leftJoin(phones, eq(ingestRuns.phoneId, phones.id))
      .orderBy(desc(ingestRuns.startedAt))
      .limit(10),
    [],
    8000,
  );

  return rows.map((row) => {
    const phoneLabel =
      phoneName(row.phoneBrand, row.phoneModel) ?? row.candidateTitle ?? 'Unknown phone';
    const diagnostics = [
      row.error ? `Error: ${row.error}` : null,
      row.rejectedReason ? `Rejected: ${row.rejectedReason}` : null,
      row.errorCode ? `Error code: ${row.errorCode}` : null,
    ].filter(isPresent);

    return {
      id: row.id,
      label: `${row.adapter}${row.stage ? ` / ${row.stage}` : ''}`,
      status: row.status,
      detail:
        row.error ?? row.rejectedReason ?? `${row.chunksCreated} chunks created for ${phoneLabel}`,
      startedAt: formatDate(row.startedAt),
      finishedAt: formatDate(row.finishedAt),
      details: [
        { label: 'Phone', value: phoneLabel },
        { label: 'Tier', value: row.tier ?? 'not set' },
        { label: 'Stage', value: row.stage ?? 'not recorded' },
        {
          label: 'Chunks',
          value: String(row.chunksCreated),
          tone: row.chunksCreated > 0 ? 'good' : 'warn',
        },
        { label: 'Duration', value: formatDuration(row.durationMs) },
        { label: 'Source', value: sourceHost(row.sourceUrl) },
      ],
      related: row.sourceUrl
        ? [
            {
              title: row.candidateTitle ?? row.sourceUrl,
              status: row.status,
              detail: row.sourceUrl,
              meta: row.phoneSlug ? `phone/${row.phoneSlug}` : row.adapter,
              href: row.sourceUrl,
            },
          ]
        : [],
      diagnostics:
        diagnostics.length > 0
          ? diagnostics
          : [
              `Completed ${row.finishedAt ? 'with a finish timestamp' : 'without finish timestamp'}.`,
            ],
    } satisfies PipelineRunRow;
  });
}

async function loadRecentScorecardRuns(db: AppDb): Promise<readonly PipelineRunRow[]> {
  const rows = await optionalQuery(
    db
      .select({
        id: scorecardRuns.id,
        aspect: scorecardRuns.aspect,
        status: scorecardRuns.status,
        skipReason: scorecardRuns.skipReason,
        score: scorecardRuns.score,
        confidence: scorecardRuns.confidence,
        nSources: scorecardRuns.nSources,
        durationMs: scorecardRuns.durationMs,
        startedAt: scorecardRuns.startedAt,
        finishedAt: scorecardRuns.finishedAt,
        error: scorecardRuns.error,
        phoneBrand: phones.brand,
        phoneModel: phones.model,
        phoneSlug: phones.slug,
      })
      .from(scorecardRuns)
      .leftJoin(phones, eq(scorecardRuns.phoneId, phones.id))
      .orderBy(desc(scorecardRuns.startedAt))
      .limit(10),
    [],
    8000,
  );

  return rows.map((row) => {
    const phoneLabel = phoneName(row.phoneBrand, row.phoneModel) ?? 'Unknown phone';
    return {
      id: row.id,
      label: `${row.aspect} / ${phoneLabel}`,
      status: row.status,
      detail:
        row.error ??
        row.skipReason ??
        `${row.nSources ?? 0} sources / ${formatDuration(row.durationMs)}`,
      startedAt: formatDate(row.startedAt),
      finishedAt: formatDate(row.finishedAt),
      details: [
        { label: 'Phone', value: phoneLabel },
        { label: 'Aspect', value: row.aspect },
        { label: 'Score', value: row.score ? `${row.score}/10` : 'not written' },
        { label: 'Confidence', value: row.confidence ?? 'not written' },
        {
          label: 'Sources',
          value: String(row.nSources ?? 0),
          tone: (row.nSources ?? 0) > 0 ? 'good' : 'warn',
        },
        { label: 'Duration', value: formatDuration(row.durationMs) },
      ],
      related: row.phoneSlug
        ? [
            {
              title: phoneLabel,
              status: row.status,
              detail: row.skipReason ?? row.error ?? 'Scorecard run telemetry',
              meta: row.phoneSlug,
              href: `/phones/${row.phoneSlug}`,
            },
          ]
        : [],
      diagnostics: [row.error, row.skipReason].filter(isPresent),
    } satisfies PipelineRunRow;
  });
}

async function loadResumeQueueRows(db: AppDb): Promise<readonly PipelineRunRow[]> {
  const rows = await optionalQuery(
    db
      .select({
        id: crawlQueue.id,
        adapter: crawlQueue.adapter,
        status: crawlQueue.status,
        tier: crawlQueue.tier,
        attempts: crawlQueue.attempts,
        scheduledFor: crawlQueue.scheduledFor,
        lastError: crawlQueue.lastError,
        url: crawlQueue.url,
        phoneBrand: phones.brand,
        phoneModel: phones.model,
        phoneSlug: phones.slug,
      })
      .from(crawlQueue)
      .innerJoin(phones, eq(crawlQueue.phoneId, phones.id))
      .orderBy(asc(crawlQueue.scheduledFor))
      .limit(10),
    [],
    8000,
  );

  return rows.map((row) => {
    const phoneLabel = phoneName(row.phoneBrand, row.phoneModel) ?? 'Unknown phone';
    return {
      id: row.id,
      label: `${row.adapter} / ${phoneLabel}`,
      status: row.status,
      detail: row.lastError ?? `${row.attempts} attempts / ${row.tier} tier`,
      startedAt: formatDate(row.scheduledFor),
      finishedAt: null,
      details: [
        { label: 'Phone', value: phoneLabel },
        { label: 'Tier', value: row.tier },
        { label: 'Adapter', value: row.adapter },
        {
          label: 'Attempts',
          value: String(row.attempts),
          tone: row.attempts > 0 ? 'warn' : 'default',
        },
        { label: 'Scheduled', value: formatDate(row.scheduledFor) ?? 'unknown' },
        { label: 'Source', value: sourceHost(row.url) },
      ],
      related: [
        {
          title: phoneLabel,
          status: row.status,
          detail: row.url ?? row.lastError ?? 'Queued resume candidate',
          meta: row.phoneSlug,
          href: row.url,
        },
      ],
      diagnostics: row.lastError
        ? [`Last queue error: ${row.lastError}`]
        : ['No queue error has been recorded for this candidate.'],
    } satisfies PipelineRunRow;
  });
}

async function loadCatalogRunRows(db: AppDb): Promise<readonly PipelineRunRow[]> {
  const runs = await optionalQuery(
    db
      .select({
        id: catalogRuns.id,
        status: catalogRuns.status,
        stage: catalogRuns.stage,
        kind: catalogRuns.kind,
        error: catalogRuns.error,
        errorCode: catalogRuns.errorCode,
        createdCount: catalogRuns.createdCount,
        updatedCount: catalogRuns.updatedCount,
        skippedCount: catalogRuns.skippedCount,
        quarantinedCount: catalogRuns.quarantinedCount,
        requestCount: catalogRuns.requestCount,
        llmCallCount: catalogRuns.llmCallCount,
        checkpointJson: catalogRuns.checkpointJson,
        startedAt: catalogRuns.startedAt,
        finishedAt: catalogRuns.finishedAt,
        durationMs: catalogRuns.durationMs,
      })
      .from(catalogRuns)
      .orderBy(desc(catalogRuns.startedAt))
      .limit(10),
    [],
    8000,
  );
  const runIds = runs.map((run) => run.id);
  if (runIds.length === 0) return [];

  const [candidates, issues] = await Promise.all([
    optionalQuery(
      db
        .select({
          id: catalogCandidates.id,
          runId: catalogCandidates.lastRunId,
          title: catalogCandidates.candidateTitle,
          status: catalogCandidates.status,
          decision: catalogCandidates.decision,
          sourceKey: catalogCandidates.sourceKey,
          sourceType: catalogCandidates.sourceType,
          sourceUrl: catalogCandidates.sourceUrl,
          confidence: catalogCandidates.confidence,
          issueCodes: catalogCandidates.issueCodes,
          lastError: catalogCandidates.lastError,
          retryAfter: catalogCandidates.retryAfter,
          matchedBrand: phones.brand,
          matchedModel: phones.model,
          matchedSlug: phones.slug,
        })
        .from(catalogCandidates)
        .leftJoin(phones, eq(catalogCandidates.matchedPhoneId, phones.id))
        .where(inArray(catalogCandidates.lastRunId, runIds))
        .orderBy(desc(catalogCandidates.updatedAt))
        .limit(80),
      [],
      8000,
    ) as Promise<CatalogCandidateRow[]>,
    optionalQuery(
      db
        .select({
          runId: catalogQualityIssues.runId,
          candidateId: catalogQualityIssues.candidateId,
          severity: catalogQualityIssues.severity,
          code: catalogQualityIssues.code,
          message: catalogQualityIssues.message,
          fieldPath: catalogQualityIssues.fieldPath,
          sourceKey: catalogQualityIssues.sourceKey,
        })
        .from(catalogQualityIssues)
        .where(inArray(catalogQualityIssues.runId, runIds))
        .orderBy(desc(catalogQualityIssues.createdAt))
        .limit(80),
      [],
      8000,
    ) as Promise<CatalogIssueRow[]>,
  ]);

  const candidatesByRun = groupBy(candidates, (candidate) => candidate.runId ?? '');
  const issuesByRun = groupBy(issues, (issue) => issue.runId ?? '');

  return runs.map((run) => {
    const runCandidates = candidatesByRun.get(run.id) ?? [];
    const runIssues = issuesByRun.get(run.id) ?? [];
    const promoted = runCandidates.filter((candidate) => candidate.status === 'promoted');
    const pending = runCandidates.filter((candidate) => candidate.decision === 'pending_review');
    const blocked = runCandidates.filter((candidate) =>
      ['quarantined', 'failed', 'failed_transient', 'rate_limited', 'quota_exhausted'].includes(
        candidate.status,
      ),
    );
    const checkpointSummary = summarizeCheckpoint(run.checkpointJson);
    const detail =
      run.error ??
      `${run.createdCount} created / ${run.updatedCount} updated / ${run.quarantinedCount} blocked`;

    return {
      id: run.id,
      label: `Catalog refresh / ${run.kind}`,
      status: run.status,
      detail,
      startedAt: formatDate(run.startedAt),
      finishedAt: formatDate(run.finishedAt),
      details: [
        { label: 'Stage', value: run.stage ?? 'not recorded' },
        {
          label: 'Created',
          value: String(run.createdCount),
          tone: run.createdCount > 0 ? 'good' : 'default',
        },
        {
          label: 'Updated',
          value: String(run.updatedCount),
          tone: run.updatedCount > 0 ? 'good' : 'default',
        },
        { label: 'Skipped', value: String(run.skippedCount) },
        {
          label: 'Blocked',
          value: String(run.quarantinedCount),
          tone: run.quarantinedCount > 0 ? 'warn' : 'default',
        },
        { label: 'Requests', value: String(run.requestCount) },
        { label: 'LLM calls', value: String(run.llmCallCount) },
        { label: 'Duration', value: formatDuration(run.durationMs) },
        { label: 'Checkpoint', value: checkpointSummary },
      ],
      related: runCandidates.slice(0, 10).map((candidate) => ({
        title: candidate.title,
        status: candidate.status,
        detail: candidateReason(candidate, runIssues),
        meta:
          phoneName(candidate.matchedBrand, candidate.matchedModel) ??
          `${candidate.sourceKey} / ${candidate.sourceType}`,
        href: candidate.sourceUrl,
      })),
      diagnostics: [
        run.error ? `Run error: ${run.error}` : null,
        run.errorCode ? `Error code: ${run.errorCode}` : null,
        promoted.length > 0 ? `${promoted.length} candidates promoted into catalog.` : null,
        pending.length > 0 ? `${pending.length} candidates still pending review.` : null,
        blocked.length > 0 ? `${blocked.length} candidates blocked or waiting for retry.` : null,
        ...runIssues
          .slice(0, 4)
          .map((issue) => `${issue.severity}: ${issue.code} - ${issue.message}`),
      ].filter(isPresent),
    } satisfies PipelineRunRow;
  });
}

async function optionalQuery<T>(promise: Promise<T>, fallback: T, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guardedPromise = promise.catch((error) => {
    console.error('pipeline run monitor query failed:', error);
    return fallback;
  });

  try {
    return await Promise.race([
      guardedPromise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch (error) {
    console.error('pipeline run monitor unexpected failure:', error);
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function groupBy<T>(rows: readonly T[], keyFn: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyFn(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function candidateReason(
  candidate: CatalogCandidateRow,
  issues: readonly CatalogIssueRow[],
): string {
  if (candidate.lastError) return candidate.lastError;
  const issue = issues.find((item) => item.candidateId === candidate.id);
  if (issue) {
    return [issue.code, issue.fieldPath, issue.message].filter(Boolean).join(' / ');
  }
  if (candidate.issueCodes.length > 0) return candidate.issueCodes.join(', ');
  if (candidate.decision === 'pending_review') {
    return 'Waiting for review/promotion decision after validation.';
  }
  if (candidate.status === 'promoted') return 'Promoted into the canonical phone catalog.';
  if (candidate.retryAfter) return `Retry after ${formatDate(candidate.retryAfter)}`;
  return `Source ${candidate.sourceKey} produced this candidate.`;
}

function summarizeCheckpoint(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'none';
  const record = value as Record<string, unknown>;
  const parts = ['source', 'limit', 'candidateIds', 'updateExisting', 'promote']
    .map((key) => {
      const raw = record[key];
      if (raw === undefined || raw === null) return null;
      if (Array.isArray(raw)) return `${key}: ${raw.length}`;
      return `${key}: ${String(raw)}`;
    })
    .filter(isPresent);
  return parts.length > 0 ? parts.join(' / ') : 'recorded';
}

function phoneName(brand: string | null, model: string | null): string | null {
  if (!brand && !model) return null;
  return [brand, model].filter(Boolean).join(' ');
}

function sourceHost(url: string | null): string {
  if (!url) return 'not recorded';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function formatDate(value: Date | null | undefined): string | null {
  return value ? value.toLocaleString('en-US') : null;
}

function formatIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('en-US');
}

function formatDuration(value: number | null | undefined): string {
  if (!value) return 'not recorded';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function workflowNameFromPath(path: string): string {
  return (
    path
      .split('/')
      .at(-1)
      ?.replace(/\.ya?ml$/i, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()) ?? 'Workflow'
  );
}

function jobTimeSummary(job: GithubJob): string {
  const started = formatIsoDate(job.started_at);
  const completed = formatIsoDate(job.completed_at);
  if (started && completed) return `${started} -> ${completed}`;
  if (started) return `Started ${started}`;
  return 'Timing not available from GitHub.';
}

function isPresent<T>(value: T | null | undefined | false): value is T {
  return Boolean(value);
}

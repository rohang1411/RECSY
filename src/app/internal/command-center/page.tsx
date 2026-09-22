import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, Database, GitBranch, Layers } from 'lucide-react';

import { LlmUsageMonitor } from '@/app/internal/pipeline/_components/llm-usage-monitor';
import { SectionHint } from '@/app/internal/pipeline/_components/section-hint';
import {
  loadCommandCenterDatabaseSummary,
  type CommandCenterDatabaseSummary,
} from '@/services/internal/database-dashboard';
import { loadLlmUsageMonitorData } from '@/services/internal/llm-usage-monitor';
import {
  loadCommandCenterIngestionSummary,
  type PhoneIngestionSummary,
} from '@/services/internal/phone-ingestion-dashboard';
import { loadAllUnifiedPipelineRuns } from '@/services/internal/pipeline-run-monitor';

import type { LlmUsageMonitorData } from '@/services/internal/llm-usage-monitor';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Command Center | RECSY',
  description:
    'Central operations hub and dashboard for RECSY database, Gemini quota, and automated pipelines.',
};

const FALLBACK_DB_DATA: CommandCenterDatabaseSummary = {
  summary: {
    totalActivePhones: 0,
    totalCandidates: 0,
    promotedCount: 0,
    blockedCount: 0,
    pendingCount: 0,
    queuedCount: 0,
    inPipelineCount: 0,
  },
  topBlockedReason: 'None',
};

const FALLBACK_INGESTION_SUMMARY: PhoneIngestionSummary = {
  totalActivePhones: 0,
  completedCount: 0,
  pendingCount: 0,
  queuedCount: 0,
  quotaExhaustedCount: 0,
  emptyCorpusCount: 0,
  failedCount: 0,
  scorecardMissingCount: 0,
  overdueCount: 0,
  neverScheduledCount: 0,
  totalChunks: 0,
  totalSources: 0,
  avgChunksPerPhone: 0,
  completionPercentage: 0,
};

const FALLBACK_LLM_USAGE: LlmUsageMonitorData = {
  googleQuota: {
    status: 'error',
    message: 'Quota monitoring unavailable.',
    rows: [],
    fetchedAt: new Date().toISOString(),
    resetAt: new Date().toISOString(),
    projects: [],
  },
  localQuota: {
    callsToday: 0,
    inputTokensToday: 0,
    outputTokensToday: 0,
    dailyLimitPerKey: 1500,
    totalDailyLimit: 1500,
    remainingCallsToday: 1500,
    keysBreakdown: [],
  },
  configuredKeyCount: 1,
  topAreas: [],
  recentEvents: [],
  modelMix: [],
  totals: {
    calls7d: 0,
    inputTokens7d: 0,
    outputTokens7d: 0,
    cacheEntries: 0,
    cacheHits: 0,
  },
};

function statusTone(status: string) {
  const s = status.toLowerCase();
  if (s === 'success' || s === 'completed' || s === 'done') return 'text-[#39ff88]';
  if (s === 'failed' || s === 'error') return 'text-[#ff3b30]';
  if (s === 'running' || s === 'in_progress') return 'text-[#ff9f1c]';
  return 'text-[#ffe45e]';
}

export default async function CommandCenterPage() {
  const [dbDataResult, llmUsageResult, allRunsResult, ingestionSummaryResult] =
    await Promise.allSettled([
      loadCommandCenterDatabaseSummary(),
      loadLlmUsageMonitorData(),
      loadAllUnifiedPipelineRuns(),
      loadCommandCenterIngestionSummary(),
    ]);

  const dbData = dbDataResult.status === 'fulfilled' ? dbDataResult.value : FALLBACK_DB_DATA;
  const llmUsage =
    llmUsageResult.status === 'fulfilled' ? llmUsageResult.value : FALLBACK_LLM_USAGE;
  const allRuns = allRunsResult.status === 'fulfilled' ? allRunsResult.value : [];
  const ingestionSummary =
    ingestionSummaryResult.status === 'fulfilled'
      ? ingestionSummaryResult.value
      : FALLBACK_INGESTION_SUMMARY;

  const { summary, topBlockedReason } = dbData;
  const recentRuns = allRuns.slice(0, 6);

  const dailyRemaining =
    llmUsage.googleQuota.status === 'ok' && llmUsage.googleQuota.rows.length > 0
      ? llmUsage.googleQuota.rows.reduce(
          (sum, r) =>
            r.unit === 'day' && typeof r.remaining === 'number' ? sum + r.remaining : sum,
          0,
        )
      : llmUsage.localQuota.remainingCallsToday;

  return (
    <main className="px-grid-margin min-w-0 flex-1 py-10">
      {/* Header */}
      <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
            Command Center
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Central executive hub / database inventory, Gemini budget rail, and pipeline
            observability
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-primary inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <span className="status-dot text-accent" data-state="running" />
            System Status: Operational
          </div>
          <span className="border-outline-variant text-muted-foreground border px-2.5 py-1 font-mono text-xs">
            v2.0.4
          </span>
        </div>
      </header>

      {/* Top High-Level Metrics */}
      <section className="border-outline-variant bg-outline-variant mt-10 grid gap-px border md:grid-cols-2 xl:grid-cols-4">
        <div className="bg-background relative overflow-hidden p-6">
          <p className="meta-label">Phones active</p>
          <p className="font-display text-gradient-steel mt-4 text-6xl leading-none font-extrabold">
            {summary.totalActivePhones.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">Promoted canonical catalog devices</p>
          <span className="font-display text-primary/5 absolute -right-2 bottom-1 text-[112px] leading-none">
            []
          </span>
        </div>

        <div className="bg-background relative overflow-hidden p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label">Candidate queue</p>
            {summary.blockedCount > 0 ? (
              <span className="border border-[#ff3b30]/30 bg-[#ff3b30]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#ff3b30]">
                {summary.blockedCount} blocked
              </span>
            ) : null}
          </div>
          <p className="font-display text-gradient-steel mt-4 text-6xl leading-none font-extrabold">
            {summary.totalCandidates.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {summary.pendingCount} pending, {summary.queuedCount} queued, {summary.blockedCount}{' '}
            blocked
          </p>
          <span className="font-display text-primary/5 absolute -right-2 bottom-1 text-[112px] leading-none">
            &#123;&#125;
          </span>
        </div>

        <div className="bg-background relative overflow-hidden p-6">
          <p className="meta-label">Free Gemini left today</p>
          <p className="font-display text-gradient-steel mt-4 text-6xl leading-none font-extrabold text-[#39ff88]">
            {dailyRemaining.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            {llmUsage.configuredKeyCount} active{' '}
            {llmUsage.configuredKeyCount === 1 ? 'key' : 'keys'} in rotation
          </p>
          <span className="font-display text-primary/5 absolute -right-2 bottom-1 text-[112px] leading-none">
            ()
          </span>
        </div>

        <div className="bg-background relative overflow-hidden p-6">
          <p className="meta-label">Automated pipeline runs</p>
          <p className="font-display text-gradient-steel mt-4 text-6xl leading-none font-extrabold">
            {allRuns.length.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 text-sm">
            Across 5 engines (Catalog, Ingest, Score, CI)
          </p>
          <span className="font-display text-primary/5 absolute -right-2 bottom-1 text-[112px] leading-none">
            ##
          </span>
        </div>
      </section>

      {/* Ingestion Fleet Readiness Bar */}
      <section className="border-outline-variant bg-surface-container/20 mt-10 border p-6 backdrop-blur-md">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="border border-[#39ff88]/40 bg-[#39ff88]/10 p-3 text-[#39ff88]">
              <Layers className="size-6" aria-hidden />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold tracking-[0.14em] text-[#39ff88] uppercase">
                  Phone Ingestion & Corpus Readiness
                </span>
                <span className="border border-[#39ff88]/30 bg-[#39ff88]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#39ff88]">
                  {ingestionSummary.completionPercentage}% Fleet Ready
                </span>
              </div>
              <h2 className="font-display text-primary mt-1 text-2xl font-bold uppercase">
                {ingestionSummary.completedCount} of {ingestionSummary.totalActivePhones} Phones
                Ingested
              </h2>
              <p className="text-muted-foreground mt-1 text-xs">
                {ingestionSummary.pendingCount > 0
                  ? `${ingestionSummary.pendingCount} active phones pending review evidence chunks or aspect scorecards.`
                  : 'All active catalog phones have complete review corpus evidence and synthesized aspect scorecards.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3 font-mono text-xs">
              <div className="border-outline-variant bg-background border px-3 py-2">
                <span className="text-muted-foreground block text-[10px] uppercase">
                  Corpus Chunks
                </span>
                <span className="text-primary text-sm font-bold">
                  {ingestionSummary.totalChunks.toLocaleString('en-US')}
                </span>
              </div>
              <div className="border-outline-variant bg-background border px-3 py-2">
                <span className="text-muted-foreground block text-[10px] uppercase">
                  Pending Queue
                </span>
                <span
                  className={`text-sm font-bold ${
                    ingestionSummary.pendingCount > 0 ? 'text-[#ffe45e]' : 'text-[#39ff88]'
                  }`}
                >
                  {ingestionSummary.pendingCount}
                </span>
              </div>
            </div>

            <Link
              href="/internal/database?view=ingestion"
              className="flex items-center gap-2 border border-[#39ff88]/50 bg-[#39ff88]/10 px-4 py-3 font-mono text-xs font-semibold tracking-[0.14em] text-[#39ff88] uppercase transition-colors hover:bg-[#39ff88]/20"
            >
              <span>Inspect Ingestion Diagnostics</span>
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Visual Progress Line */}
        <div className="bg-surface-container mt-5 h-1.5 w-full overflow-hidden">
          <div
            className="h-full bg-[#39ff88] transition-all duration-500"
            style={{ width: `${ingestionSummary.completionPercentage}%` }}
          />
        </div>
      </section>

      {/* Workspace Hub Cards */}
      <div className="mt-12">
        <SectionHint label="Command Center Workspaces">
          Decoupled operational views: navigate to dedicated workspaces for detailed database
          inventory, per-device lifecycle probing, and pipeline execution telemetry.
        </SectionHint>
        <div className="mt-4 grid gap-6 md:grid-cols-3">
          {/* Card 1: Database Dashboard */}
          <Link
            href="/internal/database"
            className="group border-outline-variant bg-background hover:border-accent flex flex-col justify-between border p-6 transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="border-accent/40 bg-accent/10 text-accent flex size-10 items-center justify-center border">
                  <Database className="size-5" aria-hidden />
                </span>
                <span className="text-muted-foreground font-mono text-[11px] uppercase">
                  {summary.totalCandidates} records
                </span>
              </div>
              <h2 className="text-primary font-display group-hover:text-accent mt-5 text-2xl font-bold uppercase transition-colors">
                Database Dashboard
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Dual-perspective database observatory: catalog candidate promotion (
                {summary.promotedCount} promoted, {summary.blockedCount} blocked) and phone
                ingestion readiness ({ingestionSummary.completedCount}/
                {ingestionSummary.totalActivePhones} ingested).
              </p>
              {summary.blockedCount > 0 ? (
                <div className="mt-4 border border-[#ff3b30]/30 bg-[#ff3b30]/5 p-2.5 text-xs">
                  <span className="font-mono font-semibold text-[#ff3b30]">Top block reason:</span>{' '}
                  <span className="text-muted-foreground">{topBlockedReason}</span>
                </div>
              ) : null}
            </div>

            <div className="border-outline-variant text-accent group-hover:text-primary mt-6 flex items-center justify-between border-t pt-4 font-mono text-xs tracking-[0.14em] uppercase">
              <span>Inspect Database & Ingestion</span>
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            </div>
          </Link>

          {/* Card 2: Lifecycle Explorer */}
          <Link
            href="/internal/lifecycle"
            className="group border-outline-variant bg-background hover:border-accent flex flex-col justify-between border p-6 transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center border border-[#00d2ff]/40 bg-[#00d2ff]/10 text-[#00d2ff]">
                  <Layers className="size-5" aria-hidden />
                </span>
                <span className="text-muted-foreground font-mono text-[11px] uppercase">
                  Per-Device Probe
                </span>
              </div>
              <h2 className="text-primary font-display group-hover:text-accent mt-5 text-2xl font-bold uppercase transition-colors">
                Lifecycle Explorer
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Interactive 3-stage schematic probe: inspect per-device raw source capture, chunk
                tokens, aspect synthesis radar, and recommendation query matching.
              </p>
              <div className="border-outline-variant bg-surface-container/40 text-muted-foreground mt-4 border p-2.5 font-mono text-xs">
                Includes Chunk Workbench & evidence density metrics
              </div>
            </div>

            <div className="border-outline-variant group-hover:text-primary mt-6 flex items-center justify-between border-t pt-4 font-mono text-xs tracking-[0.14em] text-[#00d2ff] uppercase">
              <span>Probe Device Lifecycle</span>
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            </div>
          </Link>

          {/* Card 3: Pipeline Runs & Logs */}
          <Link
            href="/internal/pipelines"
            className="group border-outline-variant bg-background hover:border-accent flex flex-col justify-between border p-6 transition-all"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="flex size-10 items-center justify-center border border-[#39ff88]/40 bg-[#39ff88]/10 text-[#39ff88]">
                  <GitBranch className="size-5" aria-hidden />
                </span>
                <span className="text-muted-foreground font-mono text-[11px] uppercase">
                  5 Engines
                </span>
              </div>
              <h2 className="text-primary font-display group-hover:text-accent mt-5 text-2xl font-bold uppercase transition-colors">
                Pipeline Runs & Logs
              </h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                Detailed run telemetry, data output verification (&quot;did it get the right
                data?&quot;), and exact script error terminal traces for debugging failures.
              </p>
              <div className="border-outline-variant bg-surface-container/40 text-muted-foreground mt-4 border p-2.5 font-mono text-xs">
                Features copyable CLI commands for instant local reproduction
              </div>
            </div>

            <div className="border-outline-variant group-hover:text-primary mt-6 flex items-center justify-between border-t pt-4 font-mono text-xs tracking-[0.14em] text-[#39ff88] uppercase">
              <span>View Execution Logs</span>
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-1"
                aria-hidden
              />
            </div>
          </Link>
        </div>
      </div>

      {/* Dual-Rail Gemini Quota Monitor */}
      <LlmUsageMonitor data={llmUsage} />

      {/* Recent Pipeline Activity Overview */}
      <section className="border-outline-variant bg-background mt-12 border">
        <div className="border-outline-variant flex flex-col gap-2 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <SectionHint label="Recent pipeline executions">
              Latest runs across all automated engines. For complete data outputs and terminal error
              traces, open the Pipeline Runs workspace.
            </SectionHint>
            <h2 className="text-primary font-display mt-2 text-xl font-bold uppercase">
              Recent Automated Pipeline Activity
            </h2>
          </div>
          <Link
            href="/internal/pipelines"
            className="border-outline text-primary hover:border-accent hover:text-accent inline-flex items-center gap-2 border px-4 py-2 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors"
          >
            <span>View All Runs & Terminal Traces</span>
            <ArrowRight className="size-3" aria-hidden />
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left">
            <thead>
              <tr className="border-outline-variant bg-surface-container/30 border-b">
                {['Pipeline Execution', 'Status', 'Data Summary / Outcome', 'Started'].map(
                  (heading) => (
                    <th
                      key={heading}
                      className="border-outline-variant text-muted-foreground border-r p-3.5 font-mono text-[11px] font-normal tracking-[0.16em] uppercase last:border-r-0"
                    >
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((run) => (
                <tr
                  key={run.id}
                  className="border-outline-variant hover:bg-surface-container/50 border-b transition-colors last:border-b-0"
                >
                  <td className="border-outline-variant border-r p-4">
                    <div className="flex items-center gap-2.5">
                      <span className="border-outline-variant bg-surface-container/60 border px-1.5 py-0.5 font-mono text-[9px] uppercase">
                        {run.engine}
                      </span>
                      <Link
                        href={`/internal/pipelines?search=${encodeURIComponent(run.label)}`}
                        className="text-primary hover:text-accent text-sm font-semibold transition-colors"
                      >
                        {run.label}
                      </Link>
                    </div>
                  </td>
                  <td className="border-outline-variant border-r p-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono text-xs font-semibold ${statusTone(run.status)}`}
                    >
                      <span className="status-dot size-2.5" data-state={run.status.toLowerCase()} />
                      {run.status}
                    </span>
                  </td>
                  <td className="border-outline-variant text-muted-foreground max-w-md truncate border-r p-4 text-xs">
                    {run.outputSummary ?? run.detail}
                  </td>
                  <td className="text-muted-foreground p-4 font-mono text-xs whitespace-nowrap">
                    {run.startedAt ?? 'unknown'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

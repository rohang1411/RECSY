import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react';

import { loadAllUnifiedPipelineRuns } from '@/services/internal/pipeline-run-monitor';

import { PipelineRunsClientView } from './_components/pipeline-runs-client-view';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Pipeline Runs & Logs | RECSY Command Center',
  description:
    'Full execution telemetry, data output verification, and script error diagnostics for RECSY pipelines.',
};

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

export default async function PipelinesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const engineParam = typeof params.engine === 'string' ? params.engine : 'all';
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const searchParam = typeof params.search === 'string' ? params.search : '';

  const allRuns = await loadAllUnifiedPipelineRuns();

  // Filter runs
  let filteredRuns = allRuns;

  if (engineParam !== 'all') {
    filteredRuns = filteredRuns.filter((r) => r.engine === engineParam);
  }

  if (statusParam !== 'all') {
    filteredRuns = filteredRuns.filter((r) => {
      const s = r.status.toLowerCase();
      if (statusParam === 'success') {
        return s === 'success' || s === 'completed' || s === 'done';
      }
      if (statusParam === 'failed') {
        return s === 'failed' || s === 'error';
      }
      if (statusParam === 'running') {
        return s === 'running' || s === 'in_progress' || s === 'queued';
      }
      return s === statusParam;
    });
  }

  if (searchParam.trim().length > 0) {
    const q = searchParam.toLowerCase().trim();
    filteredRuns = filteredRuns.filter(
      (r) =>
        r.label.toLowerCase().includes(q) ||
        r.detail.toLowerCase().includes(q) ||
        (r.scriptError && r.scriptError.toLowerCase().includes(q)) ||
        (r.outputSummary && r.outputSummary.toLowerCase().includes(q)),
    );
  }

  const successCount = allRuns.filter((r) => {
    const s = r.status.toLowerCase();
    return s === 'success' || s === 'completed' || s === 'done';
  }).length;

  const failedCount = allRuns.filter((r) => {
    const s = r.status.toLowerCase();
    return s === 'failed' || s === 'error';
  }).length;

  const runningCount = allRuns.filter((r) => {
    const s = r.status.toLowerCase();
    return s === 'running' || s === 'in_progress' || s === 'queued';
  }).length;

  return (
    <main className="px-grid-margin min-w-0 flex-1 py-10">
      <header className="accent-hairline border-outline-variant flex flex-col gap-6 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/internal/command-center"
              className="text-muted-foreground hover:text-accent font-mono text-xs tracking-[0.14em] uppercase transition-colors"
            >
              ← Command Center
            </Link>
            <span className="text-muted-foreground/40 font-mono text-xs">/</span>
            <span className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
              Pipeline Runs Console
            </span>
          </div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
            Pipeline Runs & Logs
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Data output verification, execution checkpoints, and script error diagnostics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-primary inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <span className="status-dot text-accent" data-state="running" />
            Engines: Active
          </div>
          <Link
            href="/internal/pipelines"
            className="border-outline text-primary hover:border-accent hover:text-accent border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors"
          >
            Refresh Telemetry
          </Link>
        </div>
      </header>

      {/* KPI Overview */}
      <section className="border-outline-variant bg-outline-variant mt-10 grid gap-px border md:grid-cols-4">
        <div className="bg-background p-6">
          <p className="meta-label">Total Executions</p>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
            {allRuns.length.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Across all 5 pipeline engines
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label text-[#39ff88]">Successful Runs</p>
            <CheckCircle2 className="size-4 text-[#39ff88]" aria-hidden />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold text-[#39ff88]">
            {successCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Verified data outputs produced
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label text-[#ff3b30]">Failed / Quarantined</p>
            <AlertCircle className="size-4 text-[#ff3b30]" aria-hidden />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold text-[#ff3b30]">
            {failedCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Errors with script stack traces
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label text-accent">Active / Queued</p>
            <Clock className="text-accent size-4" aria-hidden />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
            {runningCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            In flight or awaiting next cycle
          </p>
        </div>
      </section>

      {/* Filter and Interactive Table */}
      <PipelineRunsClientView
        runs={filteredRuns}
        allCount={allRuns.length}
        activeEngine={engineParam}
        activeStatus={statusParam}
        initialSearch={searchParam}
      />
    </main>
  );
}

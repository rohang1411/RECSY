'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Search,
  Terminal,
} from 'lucide-react';

import type { PipelineRunRow } from '@/services/internal/pipeline-run-monitor';

interface Props {
  readonly runs: readonly PipelineRunRow[];
  readonly allCount: number;
  readonly activeEngine: string;
  readonly activeStatus: string;
  readonly initialSearch: string;
}

const ENGINES = [
  { id: 'all', label: 'All Engines' },
  { id: 'catalog', label: 'Catalog Refresh' },
  { id: 'ingestion', label: 'Ingestion' },
  { id: 'scorecard', label: 'Scorecards' },
  { id: 'resume', label: 'Resume Queue' },
  { id: 'github', label: 'GitHub CI' },
] as const;

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'success' || normalized === 'completed' || normalized === 'done') {
    return 'text-[#39ff88]';
  }
  if (normalized === 'queued' || normalized === 'pending') return 'text-[#ffe45e]';
  if (normalized === 'running' || normalized === 'in_progress') return 'text-[#ff9f1c]';
  if (normalized === 'failed' || normalized === 'error') return 'text-[#ff3b30]';
  if (normalized === 'skipped') return 'text-[#ff7a1a]';
  return 'text-[#ffe45e]';
}

function engineBadge(engine: PipelineRunRow['engine']) {
  switch (engine) {
    case 'catalog':
      return 'border-[#00d2ff]/40 bg-[#00d2ff]/10 text-[#00d2ff]';
    case 'ingestion':
      return 'border-[#39ff88]/40 bg-[#39ff88]/10 text-[#39ff88]';
    case 'scorecard':
      return 'border-[#ffe45e]/40 bg-[#ffe45e]/10 text-[#ffe45e]';
    case 'github':
      return 'border-accent/40 bg-accent/10 text-accent';
    case 'resume':
      return 'border-outline-variant bg-surface-container/60 text-muted-foreground';
  }
}

export function PipelineRunsClientView({ runs, activeEngine, activeStatus, initialSearch }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(runs[0]?.id ?? null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <section className="mt-10 space-y-6">
      {/* Filter and Search Bar */}
      <div className="border-outline-variant bg-background border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Engine Tabs */}
          <div className="flex flex-wrap gap-1 font-mono text-xs uppercase">
            {ENGINES.map((eng) => {
              const active = activeEngine === eng.id;
              return (
                <Link
                  key={eng.id}
                  href={`/internal/pipelines?engine=${eng.id}&status=${activeStatus}&search=${encodeURIComponent(initialSearch)}`}
                  className={`border px-3 py-2 transition-colors ${
                    active
                      ? 'border-primary bg-primary text-background font-bold'
                      : 'border-outline-variant hover:border-accent hover:text-primary text-muted-foreground'
                  }`}
                >
                  {eng.label}
                </Link>
              );
            })}
          </div>

          {/* Status and Search Form */}
          <form
            action="/internal/pipelines"
            method="GET"
            className="flex flex-wrap items-center gap-3 font-mono text-xs"
          >
            <input type="hidden" name="engine" value={activeEngine} />

            <div className="border-outline bg-background flex items-center gap-2 border px-3 py-1.5">
              <Search className="text-muted-foreground size-3.5" aria-hidden />
              <input
                type="text"
                name="search"
                defaultValue={initialSearch}
                placeholder="Search run name, error, output..."
                className="text-primary placeholder:text-muted-foreground/60 w-48 bg-transparent text-xs focus:outline-none sm:w-64"
              />
            </div>

            <select
              name="status"
              defaultValue={activeStatus}
              className="border-outline bg-background text-primary focus:border-accent border px-3 py-2 text-xs focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="success">Success / Completed</option>
              <option value="failed">Failed / Quarantined</option>
              <option value="running">Running / In Progress</option>
            </select>

            <button
              type="submit"
              className="border-outline text-primary hover:border-accent hover:text-accent border px-4 py-2 text-[11px] tracking-[0.16em] uppercase transition-colors"
            >
              Filter
            </button>
          </form>
        </div>
      </div>

      {/* Runs Table */}
      <div className="border-outline-variant bg-background border">
        <div className="border-outline-variant flex items-center justify-between border-b p-4">
          <p className="meta-label text-primary">
            Showing {runs.length} {runs.length === 1 ? 'Execution' : 'Executions'}
          </p>
          <span className="text-muted-foreground font-mono text-xs">
            Click any run to inspect data output and terminal errors
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-outline-variant bg-surface-container/30 border-b">
                {[
                  'Execution / Engine',
                  'Status',
                  'Data Output / Summary',
                  'Started',
                  'Finished',
                ].map((heading) => (
                  <th
                    key={heading}
                    className="border-outline-variant text-muted-foreground border-r p-3.5 font-mono text-[11px] font-normal tracking-[0.16em] uppercase last:border-r-0"
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.length > 0 ? (
                runs.map((run) => {
                  const isExpanded = expandedId === run.id;
                  const isFailed =
                    run.status.toLowerCase() === 'failed' || run.status.toLowerCase() === 'error';

                  return (
                    <tr
                      key={run.id}
                      className={`border-outline-variant border-b transition-colors last:border-b-0 ${
                        isFailed ? 'bg-[#ff3b30]/5' : ''
                      }`}
                    >
                      <td colSpan={5} className="p-0">
                        {/* Row Summary */}
                        <div
                          onClick={() => setExpandedId(isExpanded ? null : run.id)}
                          className="hover:bg-surface-container/50 flex cursor-pointer items-center justify-between p-4 transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            {isExpanded ? (
                              <ChevronDown className="text-accent size-4 shrink-0" aria-hidden />
                            ) : (
                              <ChevronRight
                                className="text-muted-foreground size-4 shrink-0"
                                aria-hidden
                              />
                            )}
                            <span
                              className={`border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase ${engineBadge(
                                run.engine,
                              )}`}
                            >
                              {run.engine}
                            </span>
                            <span className="text-primary text-sm font-bold">{run.label}</span>
                          </div>

                          <div className="flex items-center gap-6 font-mono text-xs">
                            <span
                              className={`inline-flex items-center gap-1.5 font-semibold ${statusTone(run.status)}`}
                            >
                              <span
                                className="status-dot size-2.5"
                                data-state={run.status.toLowerCase()}
                              />
                              {run.status}
                            </span>

                            <span className="text-muted-foreground hidden max-w-sm truncate text-xs md:inline-block">
                              {run.outputSummary ?? run.detail}
                            </span>

                            <span className="text-muted-foreground text-[11px] whitespace-nowrap">
                              {run.startedAt ?? 'unknown'}
                            </span>
                          </div>
                        </div>

                        {/* Expandable Console Drawer */}
                        {isExpanded ? (
                          <div className="border-outline-variant bg-surface-container/20 border-t p-6">
                            <div className="grid gap-6 lg:grid-cols-12">
                              {/* Output Verification Column */}
                              <div className="space-y-5 lg:col-span-6">
                                <div className="border-outline-variant bg-background border p-5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <CheckCircle2 className="size-4 text-[#39ff88]" aria-hidden />
                                      <h3 className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
                                        Data Output Verification
                                      </h3>
                                    </div>
                                    <span className="text-muted-foreground font-mono text-[10px]">
                                      Did it get the right data?
                                    </span>
                                  </div>

                                  <div className="mt-3 border-l-2 border-[#39ff88] pl-3">
                                    <p className="text-primary text-sm font-medium">
                                      {run.outputSummary ?? run.detail}
                                    </p>
                                  </div>

                                  {/* Run Facts Grid */}
                                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                    {run.details.map((detail) => (
                                      <div
                                        key={detail.label}
                                        className="border-outline-variant bg-surface-container/40 border p-2.5"
                                      >
                                        <p className="text-muted-foreground font-mono text-[10px] tracking-[0.12em] uppercase">
                                          {detail.label}
                                        </p>
                                        <p
                                          className={`mt-1 font-mono text-xs font-semibold ${
                                            detail.tone === 'good'
                                              ? 'text-[#39ff88]'
                                              : detail.tone === 'bad'
                                                ? 'text-[#ff3b30]'
                                                : detail.tone === 'warn'
                                                  ? 'text-[#ffe45e]'
                                                  : 'text-primary'
                                          }`}
                                        >
                                          {detail.value}
                                        </p>
                                      </div>
                                    ))}
                                  </div>

                                  {/* Related Artifacts / Entities */}
                                  {run.related.length > 0 ? (
                                    <div className="mt-4">
                                      <p className="text-muted-foreground/80 font-mono text-[10px] tracking-[0.14em] uppercase">
                                        Entities Produced / Touched ({run.related.length})
                                      </p>
                                      <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto pr-1">
                                        {run.related.map((item, idx) => (
                                          <div
                                            key={idx}
                                            className="border-outline-variant bg-surface-container/20 flex items-center justify-between border p-2 text-xs"
                                          >
                                            <div className="flex items-center gap-2">
                                              <span className="text-primary font-medium">
                                                {item.title}
                                              </span>
                                              {item.meta ? (
                                                <span className="text-muted-foreground font-mono text-[10px]">
                                                  ({item.meta})
                                                </span>
                                              ) : null}
                                            </div>
                                            {item.href ? (
                                              <a
                                                href={item.href}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-accent inline-flex items-center gap-1 font-mono text-[10px] hover:underline"
                                              >
                                                <span>inspect</span>
                                                <ExternalLink className="size-2.5" aria-hidden />
                                              </a>
                                            ) : (
                                              <span className="text-muted-foreground font-mono text-[10px]">
                                                {item.status}
                                              </span>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>

                              {/* Error Diagnostics & CLI Terminal Column */}
                              <div className="space-y-5 lg:col-span-6">
                                <div className="border-outline-variant bg-background border p-5">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Terminal className="text-accent size-4" aria-hidden />
                                      <h3 className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
                                        Script Error & Execution Terminal
                                      </h3>
                                    </div>
                                    {run.errorCode ? (
                                      <span className="border border-[#ff3b30]/30 bg-[#ff3b30]/10 px-2 py-0.5 font-mono text-[10px] text-[#ff3b30]">
                                        {run.errorCode}
                                      </span>
                                    ) : null}
                                  </div>

                                  {/* Error Monospace Block */}
                                  {run.scriptError ? (
                                    <div className="mt-3">
                                      <div className="border-outline-variant max-h-56 overflow-x-auto border bg-black/90 p-4 font-mono text-xs text-[#ff6b6b]">
                                        <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-2">
                                          <span className="text-muted-foreground text-[10px] uppercase">
                                            Error Traceback / Message
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              copyToClipboard(
                                                run.scriptError ?? '',
                                                `err-${run.id}`,
                                              )
                                            }
                                            className="text-muted-foreground inline-flex items-center gap-1 text-[10px] hover:text-white"
                                          >
                                            {copiedId === `err-${run.id}` ? (
                                              <Check className="size-3 text-[#39ff88]" />
                                            ) : (
                                              <Copy className="size-3" />
                                            )}
                                            <span>Copy trace</span>
                                          </button>
                                        </div>
                                        <pre className="leading-relaxed whitespace-pre-wrap">
                                          {run.scriptError}
                                        </pre>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="mt-3 border border-[#39ff88]/30 bg-[#39ff88]/5 p-3 font-mono text-xs text-[#39ff88]">
                                      ✓ No script errors or exceptions were recorded for this
                                      execution.
                                    </div>
                                  )}

                                  {/* Diagnostics List */}
                                  <div className="mt-4">
                                    <p className="text-muted-foreground/80 font-mono text-[10px] tracking-[0.14em] uppercase">
                                      Execution Diagnostics
                                    </p>
                                    <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                                      {run.diagnostics.map((diag, idx) => (
                                        <li key={idx} className="flex items-start gap-2">
                                          <span className="text-accent">•</span>
                                          <span>{diag}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  {/* CLI Action Helper */}
                                  {run.cliCommand ? (
                                    <div className="border-outline-variant mt-4 border-t pt-3">
                                      <div className="flex items-center justify-between">
                                        <span className="text-muted-foreground font-mono text-[10px] uppercase">
                                          Local Terminal Reproduction Command
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyToClipboard(run.cliCommand ?? '', `cmd-${run.id}`)
                                          }
                                          className="text-accent inline-flex items-center gap-1 font-mono text-[10px] hover:underline"
                                        >
                                          {copiedId === `cmd-${run.id}` ? (
                                            <Check className="size-3 text-[#39ff88]" />
                                          ) : (
                                            <Copy className="size-3" />
                                          )}
                                          <span>Copy command</span>
                                        </button>
                                      </div>
                                      <div className="border-outline-variant text-primary mt-1.5 border bg-black/80 px-3 py-2 font-mono text-xs">
                                        <code>{run.cliCommand}</code>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="text-muted-foreground p-10 text-center text-sm">
                    No pipeline executions matched the selected filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

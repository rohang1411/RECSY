'use client';

import { Fragment, useState } from 'react';

import type { PipelineRunRow } from '@/services/internal/pipeline-run-monitor';

import { SectionHint } from './section-hint';

type RunRow = PipelineRunRow;

type WorkflowRow = {
  id: string;
  name: string;
  trigger: string;
  purpose: string;
  status: string;
};

type WorkflowTablesProps = {
  readonly ingestionRuns: readonly RunRow[];
  readonly scorecardRuns: readonly RunRow[];
  readonly resumeRows: readonly RunRow[];
  readonly catalogRefreshRuns: readonly RunRow[];
  readonly githubRuns: readonly RunRow[];
  readonly workflows: readonly WorkflowRow[];
};

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'success' || normalized === 'completed' || normalized === 'done') {
    return 'text-[#39ff88]';
  }
  if (normalized === 'queued' || normalized === 'pending') return 'text-[#ffe45e]';
  if (normalized === 'running' || normalized === 'in_progress') return 'text-[#ff9f1c]';
  if (normalized === 'failed' || normalized === 'error') return 'text-[#ff3b30]';
  if (normalized === 'skipped') return 'text-[#ff7a1a]';
  if (normalized === 'ready') return 'text-[#39ff88]';
  return 'text-[#ffe45e]';
}

function dotState(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'completed' || normalized === 'done') return 'success';
  if (normalized === 'in_progress') return 'running';
  return normalized;
}

function DataTable({ rows }: { readonly rows: readonly RunRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(rows[0]?.id ?? null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-outline-variant border-b">
            {['Name', 'Status', 'Detail', 'Started', 'Finished'].map((heading) => (
              <th
                key={heading}
                className="border-outline-variant text-muted-foreground border-r p-3 font-mono text-[11px] font-normal tracking-[0.16em] uppercase last:border-r-0"
              >
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((row) => {
              const expanded = expandedId === row.id;
              return (
                <Fragment key={row.id}>
                  <tr className="border-outline-variant hover:bg-surface-container/60 border-b transition-colors">
                    <td className="border-outline-variant border-r p-3 text-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId((current) => (current === row.id ? null : row.id))
                        }
                        aria-expanded={expanded}
                        className="text-primary hover:text-accent focus-visible:text-accent text-left transition-colors focus-visible:outline-none"
                      >
                        {row.label}
                      </button>
                    </td>
                    <td className="border-outline-variant border-r p-3 text-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedId((current) => (current === row.id ? null : row.id))
                        }
                        aria-expanded={expanded}
                        className={`inline-flex items-center gap-2 ${statusTone(row.status)}`}
                      >
                        <span className="status-dot size-3" data-state={dotState(row.status)} />
                        <span className="text-primary">{row.status}</span>
                      </button>
                    </td>
                    <td className="border-outline-variant text-muted-foreground border-r p-3 text-sm">
                      {row.detail}
                    </td>
                    <td className="border-outline-variant text-muted-foreground border-r p-3 text-sm">
                      {row.startedAt ?? 'not started'}
                    </td>
                    <td className="text-muted-foreground p-3 text-sm">
                      {row.finishedAt ?? 'not finished'}
                    </td>
                  </tr>
                  {expanded ? (
                    <tr key={`${row.id}-detail`} className="border-outline-variant border-b">
                      <td colSpan={5} className="bg-background p-0">
                        <RunDetails row={row} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          ) : (
            <tr>
              <td className="text-muted-foreground p-5 text-sm" colSpan={5}>
                No rows recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RunDetails({ row }: { readonly row: RunRow }) {
  return (
    <div className="pipeline-grid bg-outline-variant grid gap-px p-px lg:grid-cols-[0.9fr_1.1fr]">
      <div className="bg-background p-5">
        <p className="meta-label text-accent">Run facts</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {row.details.map((detail) => (
            <div key={`${row.id}-${detail.label}`} className="border-outline-variant border p-3">
              <p className="text-muted-foreground font-mono text-[10px] tracking-[0.14em] uppercase">
                {detail.label}
              </p>
              <p className={`${detailTone(detail.tone)} mt-2 text-sm leading-5 break-words`}>
                {detail.value}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-5">
          <p className="meta-label text-accent">Diagnostics</p>
          <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto pr-2">
            {row.diagnostics.length > 0 ? (
              row.diagnostics.map((item) => (
                <p
                  key={item}
                  className="border-outline-variant text-muted-foreground border p-3 text-sm leading-5"
                >
                  {item}
                </p>
              ))
            ) : (
              <p className="border-outline-variant text-muted-foreground border border-dashed p-3 text-sm">
                No failure or skip diagnostics were recorded for this run.
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="bg-background p-5">
        <p className="meta-label text-accent">Phones / sources touched</p>
        <div className="mt-4 grid max-h-80 gap-3 overflow-y-auto pr-2">
          {row.related.length > 0 ? (
            row.related.map((item) => (
              <article key={`${item.title}-${item.detail}`} className="interactive-panel p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-primary text-sm leading-5">{item.title}</p>
                    <p className="text-muted-foreground mt-1 font-mono text-[10px] tracking-[0.12em] uppercase">
                      {item.meta ?? 'run artifact'}
                    </p>
                  </div>
                  <span className={`font-mono text-[10px] uppercase ${statusTone(item.status)}`}>
                    {item.status}
                  </span>
                </div>
                <p className="text-muted-foreground mt-3 text-sm leading-5 break-words">
                  {item.detail}
                </p>
                {item.href ? (
                  <a
                    href={item.href}
                    target={item.href.startsWith('/') ? undefined : '_blank'}
                    rel={item.href.startsWith('/') ? undefined : 'noopener noreferrer'}
                    className="text-accent mt-3 inline-flex font-mono text-[10px] tracking-[0.14em] uppercase"
                  >
                    Open evidence
                  </a>
                ) : null}
              </article>
            ))
          ) : (
            <p className="border-outline-variant text-muted-foreground border border-dashed p-5 text-sm">
              This run did not record linked phones, sources, or candidates.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function detailTone(tone: RunRow['details'][number]['tone']) {
  if (tone === 'good') return 'text-[#39ff88]';
  if (tone === 'warn') return 'text-[#ffe45e]';
  if (tone === 'bad') return 'text-[#ff3b30]';
  return 'text-primary';
}

export function WorkflowTables({
  ingestionRuns,
  scorecardRuns,
  resumeRows,
  catalogRefreshRuns,
  githubRuns,
  workflows,
}: WorkflowTablesProps) {
  const sections = [
    { id: 'ingestion', title: 'Recent ingestion runs', rows: ingestionRuns },
    { id: 'scorecards', title: 'Scorecard generation', rows: scorecardRuns },
    { id: 'resume', title: 'Resume ingestion candidates', rows: resumeRows },
    { id: 'catalog', title: 'Catalog refresh runs', rows: catalogRefreshRuns },
    { id: 'github', title: 'GitHub Actions history', rows: githubRuns },
  ] as const;
  const [openId, setOpenId] = useState<string | null>('ingestion');

  return (
    <section className="border-outline-variant bg-background mt-12 border">
      <div className="border-outline-variant border-b p-5">
        <SectionHint label="Pipeline runs">
          Expands recent automation runs into phone-level outcomes, source artifacts, counts,
          failures, and catalog candidate reasons.
        </SectionHint>
      </div>
      <div className="divide-outline-variant divide-y">
        {sections.map((section) => (
          <div key={section.id}>
            <button
              type="button"
              onClick={() => setOpenId((current) => (current === section.id ? null : section.id))}
              aria-expanded={openId === section.id}
              className="interactive-panel border-outline-variant flex w-full cursor-pointer items-center justify-between border-0 border-b p-5 text-left"
            >
              <span className="meta-label text-primary">{section.title}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {section.rows.length} rows
              </span>
            </button>
            {openId === section.id ? <DataTable rows={section.rows} /> : null}
          </div>
        ))}
        <div>
          <button
            type="button"
            onClick={() => setOpenId((current) => (current === 'workflows' ? null : 'workflows'))}
            aria-expanded={openId === 'workflows'}
            className="interactive-panel border-outline-variant flex w-full cursor-pointer items-center justify-between border-0 border-b p-5 text-left"
          >
            <span className="meta-label text-primary">GitHub Actions schedules</span>
            <span className="text-muted-foreground font-mono text-xs">
              {workflows.length} workflows
            </span>
          </button>
          {openId === 'workflows' ? (
            <div className="bg-outline-variant grid gap-px p-px md:grid-cols-2">
              {workflows.map((workflow) => (
                <div key={workflow.id} className="bg-background p-5">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                      {workflow.name}
                    </p>
                    <span
                      className={`inline-flex items-center gap-2 ${statusTone(workflow.status)}`}
                    >
                      <span className="status-dot size-3" data-state={dotState(workflow.status)} />
                      <span className="font-mono text-[10px] uppercase">{workflow.status}</span>
                    </span>
                  </div>
                  <p className="text-muted-foreground mt-3 text-sm leading-6">{workflow.purpose}</p>
                  <p className="text-accent mt-4 font-mono text-[10px] tracking-[0.14em] uppercase">
                    {workflow.trigger}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

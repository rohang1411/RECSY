'use client';

import { useState } from 'react';

type RunRow = {
  id: string;
  label: string;
  status: string;
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
};

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
            rows.map((row) => (
              <tr key={row.id} className="border-outline-variant border-b last:border-b-0">
                <td className="border-outline-variant text-primary border-r p-3 text-sm">
                  {row.label}
                </td>
                <td className="border-outline-variant border-r p-3 text-sm">
                  <span className={`inline-flex items-center gap-2 ${statusTone(row.status)}`}>
                    <span className="status-dot size-3" data-state={dotState(row.status)} />
                    <span className="text-primary">{row.status}</span>
                  </span>
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
            ))
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

export function WorkflowTables({
  ingestionRuns,
  scorecardRuns,
  resumeRows,
  workflows,
}: WorkflowTablesProps) {
  const sections = [
    { id: 'ingestion', title: 'Recent ingestion runs', rows: ingestionRuns },
    { id: 'scorecards', title: 'Scorecard generation', rows: scorecardRuns },
    { id: 'resume', title: 'Resume ingestion candidates', rows: resumeRows },
  ] as const;
  const [openId, setOpenId] = useState<string | null>('ingestion');

  return (
    <section className="border-outline-variant bg-background mt-12 border">
      <div className="border-outline-variant border-b p-5">
        <p className="meta-label text-primary">Pipeline runs</p>
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

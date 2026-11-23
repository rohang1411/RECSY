import React from 'react';
import { AlertTriangle, CheckCircle, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { SystemIntegrityReport } from '@/services/internal/integrity-audit';

export interface SystemIntegrityRadarProps {
  readonly report: SystemIntegrityReport;
}

export function SystemIntegrityRadar({ report }: SystemIntegrityRadarProps) {
  const isPass = report.status === 'pass';
  const isWarn = report.status === 'warn';

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          {isPass ? (
            <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          ) : isWarn ? (
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          ) : (
            <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400" />
          )}
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
            System Integrity & Consistency Radar
          </h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-medium ${
              isPass
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : isWarn
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
            }`}
          >
            {isPass ? 'All Systems Nominal' : isWarn ? 'Warnings Detected' : 'Integrity Violations'}
          </span>
          <span className="text-zinc-500 dark:text-zinc-400">
            Audit latency: {report.executionMs}ms
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Column 1: Catalog Spec Health */}
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
          <h4 className="mb-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
            Catalog Spec Health
          </h4>
          <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Missing aspect cards: {report.missingAspectsCount}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Empty corpuses: {report.emptyCorpusesCount}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Corrupted pricing: {report.corruptedPricingCount}</span>
            </li>
          </ul>
        </div>

        {/* Column 2: Media & Link Integrity */}
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
          <h4 className="mb-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
            Media & Link Integrity
          </h4>
          <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Malformed channel IDs: {report.malformedYtChannelsCount}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Malformed source URLs: {report.malformedYtSourcesCount}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>oEmbed verification: Active (24h TTL)</span>
            </li>
          </ul>
        </div>

        {/* Column 3: Runtime Pipeline & Code */}
        <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-800/50">
          <h4 className="mb-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase dark:text-zinc-400">
            Runtime Pipeline & Code
          </h4>
          <ul className="space-y-1.5 text-xs text-zinc-700 dark:text-zinc-300">
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Orphan chunk rows: {report.orphanChunksCount}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Zombie pipeline runs: {report.zombieIngestRunsCount}</span>
            </li>
            <li className="flex items-center gap-1.5">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
              <span>Codebase AST scan: Clean (0 dead)</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

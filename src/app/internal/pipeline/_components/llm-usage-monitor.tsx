'use client';

import { Bot, DatabaseZap, Gauge, KeyRound, LineChart, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { LlmUsageAreaRow, LlmUsageMonitorData } from '@/services/internal/llm-usage-monitor';
import { summarizeVerifiedDailyQuota } from '@/services/internal/gemini-quota-summary';

import { SectionHint } from './section-hint';

type Props = {
  readonly data: LlmUsageMonitorData;
};

export function LlmUsageMonitor({ data }: Props) {
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const verified = summarizeVerifiedDailyQuota(data.googleQuota);
  const dailyRemaining = verified.remaining ?? data.localQuota.remainingCallsToday;
  const dailyUsed = verified.used ?? data.localQuota.callsToday;
  const dailyLimit = verified.limit ?? data.localQuota.totalDailyLimit;

  const limitPercent =
    dailyLimit !== null && dailyUsed !== null && dailyLimit > 0
      ? Math.min(100, Math.round((dailyUsed / dailyLimit) * 100))
      : null;
  const topMax = Math.max(1, ...data.topAreas.map((row) => row.calls));
  const visibleEvents = historyExpanded
    ? data.recentEvents.slice(0, 10)
    : data.recentEvents.slice(0, 3);

  const isVerified = verified.remaining !== null;

  return (
    <section id="gemini-quota-rail" className="border-outline-variant bg-background mt-8 overflow-hidden border scroll-mt-20">
      <div className="border-outline-variant bg-outline-variant grid gap-px border-b lg:grid-cols-[1.2fr_0.8fr]">
        <div className="pipeline-grid bg-background relative min-h-[360px] overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(circle_at_74%_36%,rgba(216,107,56,0.17),transparent_28%),linear-gradient(120deg,rgba(255,255,255,0.07),transparent_34%)]" />
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="border-accent/50 bg-accent/10 text-accent inline-flex size-10 items-center justify-center border">
                <Bot className="size-5" aria-hidden />
              </span>
              <div>
                <SectionHint label="LLM usage monitor">
                  Dual-rail telemetry: verified Google Cloud Monitoring paired with live database
                  call ledger.
                </SectionHint>
                <h2 className="text-gradient-accent-edge font-display mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
                  Gemini Quota Rail
                </h2>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <HeroMetric
                label="Daily calls left"
                value={formatMaybeNumber(dailyRemaining)}
                detail={
                  isVerified
                    ? 'Verified by Google Monitoring'
                    : data.localQuota.remainingCallsToday !== null
                      ? 'Estimated from local ledger & limits'
                      : 'Live quota tracking active'
                }
                icon={<ShieldCheck className="size-4" aria-hidden />}
              />
              <HeroMetric
                label="Used today"
                value={formatMaybeNumber(dailyUsed)}
                detail={
                  dailyLimit === null
                    ? 'Recorded in local event ledger; limit unknown'
                    : `${formatNumber(dailyLimit)} daily cap (${data.configuredKeyCount} ${data.configuredKeyCount === 1 ? 'key' : 'keys'})`
                }
                icon={<Gauge className="size-4" aria-hidden />}
              />
              <HeroMetric
                label="Active Gemini keys"
                value={String(data.configuredKeyCount)}
                detail={
                  data.googleQuota.projects.length > 0
                    ? `${data.googleQuota.projects.length} mapped to GCP quota projects`
                    : `${data.configuredKeyCount} keys rotating in cycle`
                }
                icon={<KeyRound className="size-4" aria-hidden />}
              />
            </div>

            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between gap-4 font-mono text-[11px] tracking-[0.14em] uppercase">
                <span className="text-muted-foreground">Daily request burn</span>
                <span className="text-primary">
                  {limitPercent === null ? 'Unknown' : `${limitPercent}%`}
                </span>
              </div>
              <div className="border-outline-variant bg-background h-4 border">
                <div
                  className="h-full bg-[linear-gradient(90deg,#39ff88,#ffe45e,#d86b38)] transition-[width]"
                  style={{ width: `${limitPercent ?? 0}%` }}
                />
              </div>
              <p className="text-muted-foreground mt-3 max-w-3xl text-sm leading-6">
                {quotaStatusCopy(data)}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-background p-6 sm:p-8">
          <p className="meta-label text-primary">Local ledger / 7 days</p>
          <div className="bg-outline-variant mt-6 grid gap-px">
            {[
              ['Calls', formatNumber(data.totals.calls7d)],
              ['Input tokens', formatNumber(data.totals.inputTokens7d)],
              ['Output tokens', formatNumber(data.totals.outputTokens7d)],
              ['Cache hits', formatNumber(data.totals.cacheHits)],
            ].map(([label, value]) => (
              <div
                key={label}
                className="bg-background flex items-center justify-between gap-4 p-4"
              >
                <span className="text-muted-foreground font-mono text-[11px] tracking-[0.14em] uppercase">
                  {label}
                </span>
                <span className="text-primary font-display text-3xl font-extrabold">{value}</span>
              </div>
            ))}
          </div>
          <p className="text-muted-foreground mt-4 text-xs leading-5">
            New outbound Gemini calls are persisted as events; cache entries remain visible so
            repeat prompt savings are visible without counting them as Google usage.
          </p>
        </div>
      </div>

      <div className="bg-outline-variant grid gap-px lg:grid-cols-[0.9fr_1.1fr]">
        <div className="bg-background p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="meta-label text-primary">Top usage areas</p>
            <LineChart className="text-accent size-4" aria-hidden />
          </div>
          <div className="space-y-3">
            {data.topAreas.length > 0 ? (
              data.topAreas.map((row) => <UsageAreaBar key={row.area} row={row} max={topMax} />)
            ) : (
              <EmptyState text="No LLM usage events have been recorded yet." />
            )}
          </div>
        </div>

        <div className="bg-background p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <p className="meta-label text-primary">
              Configured Gemini Key Allocation & Status
            </p>
            <span className="text-muted-foreground font-mono text-[11px]">
              {data.googleQuota.rows.length > 0
                ? `Reset ${formatTime(data.googleQuota.resetAt)}`
                : 'Local recorded usage; provider limits estimated'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-outline-variant border-b">
                  {['Key / Project', 'Status', 'Daily Cap', 'Tokens Today', 'Used Today', 'Calls Left'].map(
                    (heading) => (
                      <th
                        key={heading}
                        className="text-muted-foreground p-3 font-mono text-[11px] font-normal tracking-[0.16em] uppercase"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.localQuota?.keysBreakdown && data.localQuota.keysBreakdown.length > 0 ? (
                  data.localQuota.keysBreakdown.map((keySlot) => {
                    const gRow = data.googleQuota.rows.find(
                      (r) => r.apiKeyIndex === keySlot.apiKeyIndex,
                    );
                    const projStatus = data.googleQuota.projectStatuses?.find(
                      (p) => p.apiKeyIndex === keySlot.apiKeyIndex,
                    );
                    const isGcpVerified = Boolean(gRow && gRow.limit !== null);
                    const hasError = projStatus?.status === 'error';

                    return (
                      <tr
                        key={keySlot.apiKeyIndex}
                        className="border-outline-variant border-b last:border-b-0 hover:bg-surface-container/20 transition-colors"
                      >
                        <td className="p-3 font-mono text-xs">
                          <span className="text-primary font-bold">
                            Key #{keySlot.apiKeyIndex + 1}
                          </span>
                          <span className="text-muted-foreground block text-[11px]">
                            {keySlot.projectId ? keySlot.projectId : 'No GCP project linked'}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-xs whitespace-nowrap">
                          {isGcpVerified ? (
                            <span className="inline-flex items-center gap-1 border border-[#39ff88]/40 bg-[#39ff88]/10 px-2 py-0.5 text-[10px] font-semibold text-[#39ff88] uppercase">
                              <span className="status-dot size-1.5" data-state="running" />
                              GCP Verified
                            </span>
                          ) : hasError ? (
                            <span
                              className="inline-flex items-center gap-1 border border-[#ff3b30]/40 bg-[#ff3b30]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ff3b30] uppercase"
                              title={projStatus?.error ?? 'Cloud Monitoring permission missing'}
                            >
                              Ledger (IAM Pending)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 border border-[#ffe45e]/40 bg-[#ffe45e]/10 px-2 py-0.5 text-[10px] font-semibold text-[#ffe45e] uppercase">
                              Local Ledger
                            </span>
                          )}
                        </td>
                        <td className="text-muted-foreground p-3 font-mono text-xs">
                          {isGcpVerified && gRow?.limit != null
                            ? `${formatNumber(gRow.limit)} /day`
                            : keySlot.limit !== null
                              ? `${formatNumber(keySlot.limit)} cap`
                              : '1,500 cap'}
                        </td>
                        <td className="text-muted-foreground p-3 font-mono text-xs">
                          {formatNumber(keySlot.tokensToday)} tokens
                        </td>
                        <td className="text-primary p-3 font-mono text-sm">
                          {isGcpVerified && gRow?.used != null
                            ? `${formatNumber(gRow.used)} calls`
                            : `${formatNumber(keySlot.callsToday)} calls`}
                        </td>
                        <td className="p-3 font-mono text-sm font-bold">
                          {isGcpVerified && gRow?.remaining != null ? (
                            <span className="text-[#39ff88]">{formatNumber(gRow.remaining)}</span>
                          ) : keySlot.remainingCalls !== null ? (
                            <span className="text-[#ffe45e]">{formatNumber(keySlot.remainingCalls)}</span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="text-muted-foreground p-5 text-sm" colSpan={6}>
                      No configured Gemini keys found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="border-outline-variant border-t p-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <p className="meta-label text-primary">Recent LLM call history</p>
            <p className="text-muted-foreground mt-2 text-xs">
              Showing {visibleEvents.length} of {data.recentEvents.length} recorded calls.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {data.recentEvents.length > 3 ? (
              <button
                type="button"
                onClick={() => setHistoryExpanded((value) => !value)}
                aria-expanded={historyExpanded}
                className="border-outline text-primary hover:border-accent hover:text-accent border px-3 py-2 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors"
              >
                {historyExpanded ? 'Collapse' : 'Expand'}
              </button>
            ) : null}
            <DatabaseZap className="text-accent size-4" aria-hidden />
          </div>
        </div>
        <div className="bg-outline-variant grid max-h-[520px] gap-px overflow-y-auto">
          {data.recentEvents.length > 0 ? (
            visibleEvents.map((event) => (
              <article
                key={event.id}
                className="bg-background grid gap-3 p-4 md:grid-cols-[1fr_auto_auto] md:items-center"
              >
                <div>
                  <p className="text-primary text-sm">
                    {event.area}
                    {event.feature ? ` / ${event.feature}` : ''}
                  </p>
                  <p className="text-muted-foreground mt-1 font-mono text-[11px] uppercase">
                    {event.operation} / {event.model} / key{' '}
                    {event.apiKeyIndex === null ? '?' : event.apiKeyIndex + 1}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-xs">
                  {formatNumber(event.inputTokens + event.outputTokens)} tokens
                </p>
                <p className="text-muted-foreground font-mono text-xs">
                  {formatDate(event.createdAt)}
                </p>
              </article>
            ))
          ) : (
            <EmptyState text="No local LLM usage events exist in this connected database yet. Historical Gemini calls made before usage logging, or from another environment, cannot be reconstructed from the API key alone." />
          )}
        </div>
      </div>
    </section>
  );
}

function HeroMetric({
  label,
  value,
  detail,
  icon,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly icon: ReactNode;
}) {
  return (
    <div className="border-outline-variant bg-background/80 border p-4 backdrop-blur">
      <div className="text-accent flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] uppercase">
        {icon}
        {label}
      </div>
      <p className="text-gradient-steel font-display mt-3 text-5xl leading-none font-extrabold">
        {value}
      </p>
      <p className="text-muted-foreground mt-2 text-xs">{detail}</p>
    </div>
  );
}

function UsageAreaBar({ row, max }: { readonly row: LlmUsageAreaRow; readonly max: number }) {
  const width = Math.max(5, Math.round((row.calls / max) * 100));
  return (
    <article className="border-outline-variant border p-3">
      <div className="flex items-center justify-between gap-4">
        <p className="text-primary text-sm">{row.area}</p>
        <p className="text-muted-foreground font-mono text-xs">{row.calls} calls</p>
      </div>
      <div className="bg-outline-variant mt-3 h-2">
        <div className="bg-accent h-full" style={{ width: `${width}%` }} />
      </div>
      <p className="text-muted-foreground mt-2 font-mono text-[11px]">
        {formatNumber(row.inputTokens + row.outputTokens)} tokens / last{' '}
        {row.lastUsedAt ? formatDate(row.lastUsedAt) : 'never'}
      </p>
    </article>
  );
}

function EmptyState({ text }: { readonly text: string }) {
  return (
    <p className="text-muted-foreground border-outline-variant border border-dashed p-5 text-sm">
      {text}
    </p>
  );
}

function quotaStatusCopy(data: LlmUsageMonitorData): string {
  if (data.googleQuota.status === 'ok') {
    if (data.googleQuota.message) {
      return `${data.googleQuota.message}. Healthy projects show verified provider limits; others track via connected Postgres ledger.`;
    }
    return `Fetched directly from Google Cloud Monitoring at ${formatTime(data.googleQuota.fetchedAt)}. Values reflect Google's exported quota metrics.`;
  }
  if (data.googleQuota.status === 'not_configured') {
    return 'Google quota monitoring is not configured. Live usage is tracked accurately via your connected Postgres database ledger.';
  }
  if (data.googleQuota.message.includes('Cloud Monitoring API is disabled')) {
    return 'Google Cloud Monitoring API is disabled on your GCP project. Tracking continues seamlessly via connected Postgres database ledger.';
  }
  if (
    data.googleQuota.message.includes('Cloud Monitoring permission') ||
    data.googleQuota.message.includes('Permission denied')
  ) {
    return 'Service account lacks Cloud Monitoring Viewer permission for some projects. Verified projects display live quota; others track via Postgres event ledger.';
  }
  return `Google Cloud Monitoring unavailable (${data.googleQuota.message}). Live metrics above are powered by your Postgres event ledger.`;
}

function formatMaybeNumber(value: number | null): string {
  return value === null ? '--' : formatNumber(value);
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(value));
}

function humanizeLimit(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

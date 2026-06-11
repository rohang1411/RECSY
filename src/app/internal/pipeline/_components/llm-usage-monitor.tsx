import { Bot, DatabaseZap, Gauge, KeyRound, LineChart, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import type { LlmUsageAreaRow, LlmUsageMonitorData } from '@/services/internal/llm-usage-monitor';

type Props = {
  readonly data: LlmUsageMonitorData;
};

export function LlmUsageMonitor({ data }: Props) {
  const dailyRows = data.googleQuota.rows.filter((row) => row.unit === 'day');
  const dailyLimit = sumVerified(dailyRows.map((row) => row.limit));
  const dailyUsed = sumVerified(dailyRows.map((row) => row.used));
  const dailyRemaining = sumVerified(dailyRows.map((row) => row.remaining));
  const limitPercent =
    dailyLimit !== null && dailyUsed !== null && dailyLimit > 0
      ? Math.min(100, Math.round((dailyUsed / dailyLimit) * 100))
      : null;
  const topMax = Math.max(1, ...data.topAreas.map((row) => row.calls));

  return (
    <section className="border-outline-variant bg-background mt-12 overflow-hidden border">
      <div className="border-outline-variant bg-outline-variant grid gap-px border-b lg:grid-cols-[1.2fr_0.8fr]">
        <div className="pipeline-grid bg-background relative min-h-[360px] overflow-hidden p-6 sm:p-8">
          <div className="pointer-events-none absolute inset-0 opacity-80 [background:radial-gradient(circle_at_74%_36%,rgba(216,107,56,0.17),transparent_28%),linear-gradient(120deg,rgba(255,255,255,0.07),transparent_34%)]" />
          <div className="relative z-10">
            <div className="flex flex-wrap items-center gap-3">
              <span className="border-accent/50 bg-accent/10 text-accent inline-flex size-10 items-center justify-center border">
                <Bot className="size-5" aria-hidden />
              </span>
              <div>
                <p className="meta-label text-primary">LLM usage monitor</p>
                <h2 className="text-gradient-accent-edge font-display mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
                  Gemini Quota Rail
                </h2>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <HeroMetric
                label="Free left today"
                value={formatMaybeNumber(dailyRemaining)}
                detail="Verified by Google Monitoring"
                icon={<ShieldCheck className="size-4" aria-hidden />}
              />
              <HeroMetric
                label="Used today"
                value={formatMaybeNumber(dailyUsed)}
                detail={
                  dailyLimit === null ? 'Limit unavailable' : `${formatNumber(dailyLimit)} limit`
                }
                icon={<Gauge className="size-4" aria-hidden />}
              />
              <HeroMetric
                label="Keys tracked"
                value={`${data.googleQuota.projects.length}/${data.configuredKeyCount}`}
                detail="Project-backed API keys"
                icon={<KeyRound className="size-4" aria-hidden />}
              />
            </div>

            <div className="mt-8">
              <div className="mb-2 flex items-center justify-between gap-4 font-mono text-[11px] tracking-[0.14em] uppercase">
                <span className="text-muted-foreground">Daily request burn</span>
                <span className="text-primary">
                  {limitPercent === null ? 'No Google row' : `${limitPercent}%`}
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
            <p className="meta-label text-primary">Google quota rows</p>
            <span className="text-muted-foreground font-mono text-[11px]">
              Reset {formatTime(data.googleQuota.resetAt)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr className="border-outline-variant border-b">
                  {['Project', 'Limit', 'Model', 'Used', 'Left'].map((heading) => (
                    <th
                      key={heading}
                      className="text-muted-foreground p-3 font-mono text-[11px] font-normal tracking-[0.16em] uppercase"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.googleQuota.rows.length > 0 ? (
                  data.googleQuota.rows.slice(0, 8).map((row) => (
                    <tr
                      key={`${row.projectId}-${row.limitName}-${row.model}`}
                      className="border-outline-variant border-b last:border-b-0"
                    >
                      <td className="text-primary p-3 font-mono text-xs">
                        key {row.apiKeyIndex + 1} / {row.projectId}
                      </td>
                      <td className="text-muted-foreground p-3 text-sm">
                        {humanizeLimit(row.limitName)}
                      </td>
                      <td className="text-muted-foreground p-3 text-sm">
                        {row.model ?? 'all models'}
                      </td>
                      <td className="text-primary p-3 font-mono text-sm">
                        {formatMaybeNumber(row.used)}
                      </td>
                      <td className="text-accent p-3 font-mono text-sm">
                        {formatMaybeNumber(row.remaining)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="text-muted-foreground p-5 text-sm" colSpan={5}>
                      Google did not return quota rows for the current configuration.
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
          <p className="meta-label text-primary">Recent LLM call history</p>
          <DatabaseZap className="text-accent size-4" aria-hidden />
        </div>
        <div className="bg-outline-variant grid gap-px">
          {data.recentEvents.length > 0 ? (
            data.recentEvents.map((event) => (
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
            <EmptyState text="Usage history will appear after the next outbound Gemini call." />
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
    return `Fetched directly from Google Cloud Monitoring at ${formatTime(data.googleQuota.fetchedAt)}. Values reflect Google's exported quota metrics, not RECSY estimates.`;
  }
  if (data.googleQuota.status === 'not_configured') return data.googleQuota.message;
  return `Google quota fetch failed: ${data.googleQuota.message}`;
}

function sumVerified(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => typeof value === 'number');
  return present.length > 0 ? present.reduce((sum, value) => sum + value, 0) : null;
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

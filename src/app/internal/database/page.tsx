import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';

import {
  loadDatabaseDashboardData,
  type DatabaseFilterParams,
  type DeviceCategory,
  type DeviceRowItem,
} from '@/services/internal/database-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Database Dashboard | RECSY Command Center',
  description:
    'Full database visibility for all phones, blocked reasons, and catalog candidate pipelines.',
};

interface PageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}

function categoryBadge(category: DeviceCategory, status: string) {
  switch (category) {
    case 'promoted':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#39ff88]/40 bg-[#39ff88]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#39ff88] uppercase">
          <CheckCircle2 className="size-3" aria-hidden />
          Promoted
        </span>
      );
    case 'blocked':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#ff3b30]/40 bg-[#ff3b30]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#ff3b30] uppercase">
          <ShieldAlert className="size-3" aria-hidden />
          {status === 'quarantined' ? 'Quarantined' : status}
        </span>
      );
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#ffe45e]/40 bg-[#ffe45e]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#ffe45e] uppercase">
          <AlertTriangle className="size-3" aria-hidden />
          Pending Review
        </span>
      );
    case 'pipeline':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#00d2ff]/40 bg-[#00d2ff]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#00d2ff] uppercase">
          <RefreshCw className="size-3 animate-spin" aria-hidden />
          In Pipeline ({status})
        </span>
      );
    case 'queued':
      return (
        <span className="border-outline-variant bg-surface-container/60 text-muted-foreground inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase">
          <Clock className="size-3" aria-hidden />
          Queued
        </span>
      );
  }
}

export default async function DatabaseDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const reasonParam = typeof params.reason === 'string' ? params.reason : 'all';
  const brandParam = typeof params.brand === 'string' ? params.brand : 'all';
  const searchParam = typeof params.search === 'string' ? params.search : '';

  const filterParams: DatabaseFilterParams = {
    status: statusParam,
    reason: reasonParam,
    brand: brandParam,
    search: searchParam,
  };

  const data = await loadDatabaseDashboardData(filterParams);
  const { summary, blockedReasons, devices, brands } = data;

  const hasActiveFilters =
    statusParam !== 'all' ||
    reasonParam !== 'all' ||
    brandParam !== 'all' ||
    searchParam.length > 0;

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
              Database Observatory
            </span>
          </div>
          <h1 className="heading-scanline font-display text-gradient-accent-edge mt-2 text-4xl leading-none font-extrabold uppercase sm:text-6xl">
            Database Dashboard
          </h1>
          <p className="text-muted-foreground mt-3 font-mono text-xs tracking-[0.16em] uppercase">
            Catalog phone inventory, candidate pipeline statuses, and quarantine root-cause
            diagnostics
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-primary inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <span className="status-dot text-accent" data-state="running" />
            Database: Connected
          </div>
          <Link
            href="/internal/database"
            className="border-outline text-primary hover:border-accent hover:text-accent border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors"
          >
            Refresh
          </Link>
        </div>
      </header>

      {/* KPI Overview Grid */}
      <section className="border-outline-variant bg-outline-variant mt-10 grid gap-px border md:grid-cols-2 xl:grid-cols-5">
        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label">Promoted / Active</p>
            <span className="size-2 rounded-full bg-[#39ff88]" />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
            {summary.promotedCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Active in canonical phone catalog
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label text-[#ff3b30]">Blocked / Quarantined</p>
            <span className="size-2 rounded-full bg-[#ff3b30]" />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold text-[#ff3b30]">
            {summary.blockedCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Validation failures & errors
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label text-[#ffe45e]">Pending Review</p>
            <span className="size-2 rounded-full bg-[#ffe45e]" />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
            {summary.pendingCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Awaiting manual or staged review
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label text-[#00d2ff]">In Pipeline</p>
            <span className="size-2 rounded-full bg-[#00d2ff]" />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
            {summary.inPipelineCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Discovered, fetching, or extracting
          </p>
        </div>

        <div className="bg-background p-6">
          <div className="flex items-center justify-between">
            <p className="meta-label">Queued</p>
            <span className="bg-muted-foreground size-2 rounded-full" />
          </div>
          <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
            {summary.queuedCount.toLocaleString('en-US')}
          </p>
          <p className="text-muted-foreground mt-2 font-mono text-xs">
            Scheduled for crawl / promotion
          </p>
        </div>
      </section>

      {/* Blocked Reasons Breakdown Rail */}
      {blockedReasons.length > 0 ? (
        <section className="border-outline-variant bg-background mt-10 border p-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-[#ff3b30]" aria-hidden />
                <h2 className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
                  Blocked Phones Root-Cause Breakdown
                </h2>
              </div>
              <p className="text-muted-foreground mt-1 text-xs">
                Click any reason to filter the database and inspect the exact phones blocked by that
                specific issue.
              </p>
            </div>
            {reasonParam !== 'all' ? (
              <Link
                href={`/internal/database?status=${statusParam}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                className="text-accent font-mono text-xs tracking-[0.12em] uppercase hover:underline"
              >
                Clear reason filter ×
              </Link>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {blockedReasons.map(({ code, label, count }) => {
              const active = reasonParam.toLowerCase() === code.toLowerCase();
              return (
                <Link
                  key={code}
                  href={`/internal/database?status=blocked&reason=${encodeURIComponent(code)}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                  className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-xs transition-colors ${
                    active
                      ? 'border-[#ff3b30] bg-[#ff3b30]/20 font-bold text-[#ff3b30]'
                      : 'border-outline-variant bg-surface-container/40 text-muted-foreground hover:text-primary hover:border-[#ff3b30]/50'
                  }`}
                >
                  <span>{label}</span>
                  <span className="border-outline-variant bg-background px-1.5 py-0.5 text-[10px] font-bold text-[#ff3b30]">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Filters and Search Bar */}
      <section className="border-outline-variant bg-background mt-10 border p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Status Tabs */}
          <div className="flex flex-wrap gap-1 font-mono text-xs uppercase">
            {[
              { id: 'all', label: 'All Entries', count: devices.length },
              { id: 'promoted', label: 'Promoted', count: summary.promotedCount },
              { id: 'blocked', label: 'Blocked', count: summary.blockedCount },
              { id: 'pending', label: 'Pending Review', count: summary.pendingCount },
              { id: 'pipeline', label: 'In Pipeline', count: summary.inPipelineCount },
              { id: 'queued', label: 'Queued', count: summary.queuedCount },
            ].map((tab) => {
              const active = statusParam === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={`/internal/database?status=${tab.id}&reason=${reasonParam}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                  className={`border px-3 py-2 transition-colors ${
                    active
                      ? 'border-primary bg-primary text-background font-bold'
                      : 'border-outline-variant hover:border-accent hover:text-primary text-muted-foreground'
                  }`}
                >
                  {tab.label} ({tab.count})
                </Link>
              );
            })}
          </div>

          {/* Search and Brand Form */}
          <form
            action="/internal/database"
            method="GET"
            className="flex flex-wrap items-center gap-3 font-mono text-xs"
          >
            <input type="hidden" name="status" value={statusParam} />
            <input type="hidden" name="reason" value={reasonParam} />

            <div className="border-outline bg-background flex items-center gap-2 border px-3 py-1.5">
              <Search className="text-muted-foreground size-3.5" aria-hidden />
              <input
                type="text"
                name="search"
                defaultValue={searchParam}
                placeholder="Search phone name, model, source..."
                className="text-primary placeholder:text-muted-foreground/60 w-48 bg-transparent text-xs focus:outline-none sm:w-64"
              />
            </div>

            <select
              name="brand"
              defaultValue={brandParam}
              className="border-outline bg-background text-primary focus:border-accent border px-3 py-2 text-xs focus:outline-none"
            >
              <option value="all">All Brands ({brands.length})</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <button
              type="submit"
              className="border-outline text-primary hover:border-accent hover:text-accent border px-4 py-2 text-[11px] tracking-[0.16em] uppercase transition-colors"
            >
              Filter
            </button>

            {hasActiveFilters ? (
              <Link
                href="/internal/database"
                className="text-muted-foreground hover:text-primary border border-transparent px-2 py-2 text-[11px] tracking-[0.14em] uppercase"
              >
                Reset
              </Link>
            ) : null}
          </form>
        </div>
      </section>

      {/* Phones and Candidates Table */}
      <section className="border-outline-variant bg-background mt-6 border">
        <div className="border-outline-variant flex items-center justify-between border-b p-4">
          <p className="meta-label text-primary">
            Showing {devices.length} {devices.length === 1 ? 'Device' : 'Devices'}
          </p>
          <span className="text-muted-foreground font-mono text-xs">
            Sorted by most recently updated
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left">
            <thead>
              <tr className="border-outline-variant bg-surface-container/30 border-b">
                {[
                  'Exact Phone / Candidate Name',
                  'Category & Status',
                  'Reason Blocked / Diagnostic',
                  'Source',
                  'Updated',
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
              {devices.length > 0 ? (
                devices.map((device) => <DeviceTableRow key={device.id} device={device} />)
              ) : (
                <tr>
                  <td colSpan={5} className="text-muted-foreground p-10 text-center text-sm">
                    No devices matched the selected filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function DeviceTableRow({ device }: { readonly device: DeviceRowItem }) {
  const isBlocked = device.category === 'blocked';

  return (
    <tr
      className={`border-outline-variant hover:bg-surface-container/50 border-b transition-colors last:border-b-0 ${
        isBlocked ? 'bg-[#ff3b30]/5' : ''
      }`}
    >
      {/* Phone Name */}
      <td className="border-outline-variant max-w-[280px] border-r p-4">
        <div className="flex flex-col">
          <span className="text-primary text-sm leading-snug font-bold">{device.name}</span>
          <div className="text-muted-foreground mt-1 flex items-center gap-2 font-mono text-[11px]">
            {device.brand ? <span>{device.brand}</span> : null}
            {device.model ? <span>• {device.model}</span> : null}
            {device.phoneSlug ? (
              <Link
                href={`/phones/${device.phoneSlug}`}
                className="text-accent inline-flex items-center gap-1 text-[10px] hover:underline"
                target="_blank"
                rel="noreferrer"
              >
                <span>view phone</span>
                <ExternalLink className="size-2.5" aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>
      </td>

      {/* Category & Status */}
      <td className="border-outline-variant border-r p-4 whitespace-nowrap">
        <div className="flex flex-col items-start gap-1.5">
          {categoryBadge(device.category, device.status)}
          {device.decision ? (
            <span className="text-muted-foreground font-mono text-[10px]">
              decision: {device.decision}
            </span>
          ) : null}
        </div>
      </td>

      {/* Reason Blocked / Diagnostic Detail */}
      <td className="border-outline-variant max-w-[380px] border-r p-4">
        {isBlocked ? (
          <div className="space-y-1.5">
            <div className="font-mono text-xs font-semibold break-words text-[#ff3b30]">
              {device.blockedReason ?? 'Quarantined / Unspecified validation failure'}
            </div>
            {device.issueCodes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {device.issueCodes.map((code) => (
                  <span
                    key={code}
                    className="border border-[#ff3b30]/30 bg-[#ff3b30]/10 px-1.5 py-0.5 font-mono text-[9px] text-[#ff3b30]"
                  >
                    {code}
                  </span>
                ))}
              </div>
            ) : null}
            {device.qualityIssues.length > 0 ? (
              <div className="text-muted-foreground mt-1 space-y-1 border-t border-[#ff3b30]/20 pt-1 text-[11px]">
                {device.qualityIssues.slice(0, 2).map((q, idx) => (
                  <p key={idx}>
                    <span className="font-mono font-semibold text-[#ff3b30]">{q.code}:</span>{' '}
                    {q.message}
                  </p>
                ))}
              </div>
            ) : null}
            {device.retryAfter ? (
              <p className="text-muted-foreground font-mono text-[10px]">
                Retry scheduled: {new Date(device.retryAfter).toLocaleString('en-US')}
              </p>
            ) : null}
          </div>
        ) : device.category === 'pending' ? (
          <div className="text-muted-foreground text-xs">
            <p className="font-mono text-[11px] text-[#ffe45e]">
              {device.decision === 'pending_review'
                ? 'Awaiting promotion review'
                : 'Validated, ready for review'}
            </p>
            <p className="mt-0.5 text-[11px]">Confidence score: {device.confidence ?? 'pending'}</p>
          </div>
        ) : device.category === 'promoted' ? (
          <div className="text-muted-foreground text-xs">
            <p className="font-mono text-[11px] text-[#39ff88]">Active catalog device</p>
            <p className="mt-0.5 text-[11px]">Canonical slug: {device.phoneSlug ?? 'in-catalog'}</p>
          </div>
        ) : (
          <div className="text-muted-foreground font-mono text-xs">
            Stage: {device.status} / {device.attempts} attempts
          </div>
        )}
      </td>

      {/* Source */}
      <td className="border-outline-variant border-r p-4 whitespace-nowrap">
        <div className="flex flex-col">
          <span className="text-primary font-mono text-xs font-semibold">{device.sourceKey}</span>
          {device.sourceUrl ? (
            <a
              href={device.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-accent mt-1 inline-flex max-w-[140px] items-center gap-1 truncate font-mono text-[10px]"
            >
              <span>source link</span>
              <ExternalLink className="size-2.5" aria-hidden />
            </a>
          ) : null}
        </div>
      </td>

      {/* Updated Timestamp */}
      <td className="text-muted-foreground p-4 font-mono text-xs whitespace-nowrap">
        {new Date(device.updatedAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })}
      </td>
    </tr>
  );
}

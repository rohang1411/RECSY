import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  FileText,
  Layers,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

import {
  loadDatabaseDashboardData,
  type DatabaseFilterParams,
  type DeviceCategory,
  type DeviceRowItem,
} from '@/services/internal/database-dashboard';
import {
  loadPhoneIngestionDashboardData,
  type IngestionFilterParams,
  type IngestionStatusCategory,
  type PhoneIngestionRow,
} from '@/services/internal/phone-ingestion-dashboard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Database Dashboard | RECSY Command Center',
  description:
    'Full database visibility for phone catalog candidates, ingestion completion, and pending diagnostics.',
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

function ingestionStatusBadge(status: IngestionStatusCategory, isOverdue: boolean) {
  switch (status) {
    case 'complete':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#39ff88]/40 bg-[#39ff88]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#39ff88] uppercase">
          <CheckCircle2 className="size-3" aria-hidden />
          Complete {isOverdue ? '(Overdue)' : ''}
        </span>
      );
    case 'queued':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#ffe45e]/40 bg-[#ffe45e]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#ffe45e] uppercase">
          <Clock className="size-3" aria-hidden />
          In Queue
        </span>
      );
    case 'quota_exhausted':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#ff9f0a]/40 bg-[#ff9f0a]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#ff9f0a] uppercase">
          <AlertTriangle className="size-3" aria-hidden />
          Quota Blocked
        </span>
      );
    case 'empty_corpus':
      return (
        <span className="inline-flex items-center gap-1.5 border border-zinc-500/40 bg-zinc-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-zinc-400 uppercase">
          <FileText className="size-3" aria-hidden />0 Chunks
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#ff3b30]/40 bg-[#ff3b30]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#ff3b30] uppercase">
          <ShieldAlert className="size-3" aria-hidden />
          Failed
        </span>
      );
    case 'scorecard_missing':
      return (
        <span className="inline-flex items-center gap-1.5 border border-[#00d2ff]/40 bg-[#00d2ff]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#00d2ff] uppercase">
          <Sparkles className="size-3" aria-hidden />
          Needs Scorecard
        </span>
      );
    case 'never_scheduled':
      return (
        <span className="border-outline-variant bg-surface-container/60 text-muted-foreground inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase">
          <Clock className="size-3" aria-hidden />
          Unscheduled
        </span>
      );
  }
}

function tierBadge(tier: 'hot' | 'warm' | 'cold') {
  switch (tier) {
    case 'hot':
      return (
        <span className="border border-[#ff9f0a]/40 bg-[#ff9f0a]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#ff9f0a] uppercase">
          HOT
        </span>
      );
    case 'warm':
      return (
        <span className="border border-[#ffe45e]/40 bg-[#ffe45e]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#ffe45e] uppercase">
          WARM
        </span>
      );
    case 'cold':
      return (
        <span className="border border-[#00d2ff]/40 bg-[#00d2ff]/10 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#00d2ff] uppercase">
          COLD
        </span>
      );
  }
}

export default async function DatabaseDashboardPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const viewParam =
    typeof params.view === 'string' && params.view.toLowerCase() === 'ingestion'
      ? 'ingestion'
      : 'catalog';
  const statusParam = typeof params.status === 'string' ? params.status : 'all';
  const reasonParam = typeof params.reason === 'string' ? params.reason : 'all';
  const brandParam = typeof params.brand === 'string' ? params.brand : 'all';
  const searchParam = typeof params.search === 'string' ? params.search : '';

  // Concurrently load both data sets to keep view switching instantaneous
  const catalogFilterParams: DatabaseFilterParams = {
    status: statusParam,
    reason: reasonParam,
    brand: brandParam,
    search: searchParam,
  };

  const INGESTION_REASON_CODES = [
    'in_crawl_queue',
    'quota_exhausted',
    'rate_limited',
    'empty_corpus',
    'scorecard_missing',
    'spec_embedding_missing',
    'ingest_run_failed',
    'overdue_refresh',
    'never_scheduled',
  ];

  const isIngestionReason = INGESTION_REASON_CODES.includes(reasonParam.toLowerCase());

  const ingestionFilterParams: IngestionFilterParams = {
    status: statusParam,
    reason: isIngestionReason ? reasonParam : 'all',
    brand: brandParam,
    search: searchParam,
  };

  const [catalogData, ingestionData] = await Promise.all([
    loadDatabaseDashboardData(catalogFilterParams),
    loadPhoneIngestionDashboardData(ingestionFilterParams),
  ]);

  const hasActiveFilters =
    statusParam !== 'all' ||
    reasonParam !== 'all' ||
    brandParam !== 'all' ||
    searchParam.length > 0;

  return (
    <main className="px-grid-margin min-w-0 flex-1 py-10">
      {/* Header */}
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
            {viewParam === 'ingestion'
              ? 'Phone review ingestion status, corpus evidence coverage, and pending root-cause diagnostics'
              : 'Catalog phone inventory, candidate pipeline statuses, and quarantine root-cause diagnostics'}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-primary inline-flex items-center gap-2 font-mono text-xs tracking-[0.14em] uppercase">
            <span className="status-dot text-accent" data-state="running" />
            Database: Connected
          </div>
          <Link
            href={`/internal/database?view=${viewParam}`}
            className="border-outline text-primary hover:border-accent hover:text-accent border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors"
          >
            Refresh
          </Link>
        </div>
      </header>

      {/* Perspective / View Mode Switcher */}
      <section className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="border-outline-variant bg-surface-container/40 flex items-center gap-1.5 border p-1.5 backdrop-blur-md">
          <Link
            href={`/internal/database?view=catalog${brandParam !== 'all' ? `&brand=${brandParam}` : ''}`}
            className={`flex items-center gap-2 px-4 py-2 font-mono text-xs font-semibold tracking-[0.14em] uppercase transition-all ${
              viewParam === 'catalog'
                ? 'border-primary/50 bg-primary/20 text-primary border shadow-[0_0_15px_rgba(0,210,255,0.2)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-container/60'
            }`}
          >
            <Database className="size-3.5" aria-hidden />
            Catalog Candidates & Promotion
            <span
              className={`px-1.5 py-0.5 text-[10px] ${
                viewParam === 'catalog'
                  ? 'bg-primary text-background font-bold'
                  : 'bg-surface-container text-muted-foreground'
              }`}
            >
              {catalogData.summary.totalCandidates}
            </span>
          </Link>

          <Link
            href={`/internal/database?view=ingestion${brandParam !== 'all' ? `&brand=${brandParam}` : ''}`}
            className={`flex items-center gap-2 px-4 py-2 font-mono text-xs font-semibold tracking-[0.14em] uppercase transition-all ${
              viewParam === 'ingestion'
                ? 'border border-[#39ff88]/50 bg-[#39ff88]/20 text-[#39ff88] shadow-[0_0_15px_rgba(57,255,136,0.2)]'
                : 'text-muted-foreground hover:text-foreground hover:bg-surface-container/60'
            }`}
          >
            <Layers className="size-3.5" aria-hidden />
            Phone Ingestion & Corpus Health
            <span
              className={`px-1.5 py-0.5 text-[10px] ${
                viewParam === 'ingestion'
                  ? 'text-background bg-[#39ff88] font-bold'
                  : 'bg-surface-container text-muted-foreground'
              }`}
            >
              {ingestionData.summary.completedCount}/{ingestionData.summary.totalActivePhones}
            </span>
          </Link>
        </div>

        <div className="text-muted-foreground flex items-center gap-2 font-mono text-xs">
          <Radio className="size-3 animate-pulse text-[#39ff88]" />
          <span>Active View:</span>
          <span className="text-primary font-bold uppercase">
            {viewParam === 'ingestion' ? 'Review & Corpus Ingestion' : 'Catalog Promotion Funnel'}
          </span>
        </div>
      </section>

      {/* CONDITIONAL PERSPECTIVE: VIEW 1 - CATALOG & CANDIDATES */}
      {viewParam === 'catalog' ? (
        <>
          {/* KPI Overview Grid */}
          <section className="border-outline-variant bg-outline-variant mt-8 grid gap-px border md:grid-cols-2 xl:grid-cols-5">
            <div className="bg-background p-6">
              <div className="flex items-center justify-between">
                <p className="meta-label">Promoted / Active</p>
                <span className="size-2 rounded-full bg-[#39ff88]" />
              </div>
              <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
                {catalogData.summary.promotedCount.toLocaleString('en-US')}
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
                {catalogData.summary.blockedCount.toLocaleString('en-US')}
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
                {catalogData.summary.pendingCount.toLocaleString('en-US')}
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
                {catalogData.summary.inPipelineCount.toLocaleString('en-US')}
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
                {catalogData.summary.queuedCount.toLocaleString('en-US')}
              </p>
              <p className="text-muted-foreground mt-2 font-mono text-xs">
                Scheduled for crawl / promotion
              </p>
            </div>
          </section>

          {/* Blocked Reasons Breakdown Rail */}
          {catalogData.blockedReasons.length > 0 ? (
            <section className="border-outline-variant bg-background mt-8 border p-6">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldAlert className="size-4 text-[#ff3b30]" aria-hidden />
                    <h2 className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
                      Blocked Phones Root-Cause Breakdown
                    </h2>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Click any reason to filter the database and inspect the exact phones blocked by
                    that specific issue.
                  </p>
                </div>
                {reasonParam !== 'all' ? (
                  <Link
                    href={`/internal/database?view=catalog&status=${statusParam}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                    className="text-accent font-mono text-xs tracking-[0.12em] uppercase hover:underline"
                  >
                    Clear reason filter ×
                  </Link>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {catalogData.blockedReasons.map(({ code, label, count }) => {
                  const active = reasonParam.toLowerCase() === code.toLowerCase();
                  return (
                    <Link
                      key={code}
                      href={`/internal/database?view=catalog&status=blocked&reason=${encodeURIComponent(code)}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
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
          <section className="border-outline-variant bg-background mt-8 border p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {/* Status Tabs */}
              <div className="flex flex-wrap gap-1 font-mono text-xs uppercase">
                {[
                  { id: 'all', label: 'All Entries', count: catalogData.devices.length },
                  { id: 'promoted', label: 'Promoted', count: catalogData.summary.promotedCount },
                  { id: 'blocked', label: 'Blocked', count: catalogData.summary.blockedCount },
                  {
                    id: 'pending',
                    label: 'Pending Review',
                    count: catalogData.summary.pendingCount,
                  },
                  {
                    id: 'pipeline',
                    label: 'In Pipeline',
                    count: catalogData.summary.inPipelineCount,
                  },
                  { id: 'queued', label: 'Queued', count: catalogData.summary.queuedCount },
                ].map((tab) => {
                  const active = statusParam === tab.id;
                  return (
                    <Link
                      key={tab.id}
                      href={`/internal/database?view=catalog&status=${tab.id}&reason=${reasonParam}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
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
                <input type="hidden" name="view" value="catalog" />
                <input type="hidden" name="status" value={statusParam} />
                <input type="hidden" name="reason" value={reasonParam} />

                <div className="border-outline bg-background flex items-center gap-2 border px-3 py-1.5">
                  <Search className="text-muted-foreground size-3.5" aria-hidden />
                  <input
                    type="text"
                    name="search"
                    defaultValue={searchParam}
                    placeholder="Search phone name, model..."
                    className="text-primary placeholder:text-muted-foreground/60 w-48 bg-transparent text-xs focus:outline-none sm:w-64"
                  />
                </div>

                <select
                  name="brand"
                  defaultValue={brandParam}
                  className="border-outline bg-background text-primary focus:border-accent border px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="all">All Brands ({catalogData.brands.length})</option>
                  {catalogData.brands.map((b) => (
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
                    href="/internal/database?view=catalog"
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
                Showing {catalogData.devices.length}{' '}
                {catalogData.devices.length === 1 ? 'Device' : 'Devices'}
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
                  {catalogData.devices.length > 0 ? (
                    catalogData.devices.map((device) => (
                      <DeviceTableRow key={device.id} device={device} />
                    ))
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
        </>
      ) : (
        /* CONDITIONAL PERSPECTIVE: VIEW 2 - PHONE INGESTION & CORPUS HEALTH */
        <>
          {/* Ingestion KPI Overview Rail */}
          <section className="border-outline-variant bg-outline-variant mt-8 grid gap-px border md:grid-cols-2 xl:grid-cols-4">
            {/* Card 1: Ingestion Completion */}
            <div className="bg-background relative overflow-hidden p-6">
              <div className="flex items-center justify-between">
                <p className="meta-label text-[#39ff88]">Ingestion Complete</p>
                <span className="size-2 animate-pulse rounded-full bg-[#39ff88]" />
              </div>
              <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold text-[#39ff88]">
                {ingestionData.summary.completedCount}
                <span className="text-muted-foreground text-2xl font-normal">
                  /{ingestionData.summary.totalActivePhones}
                </span>
              </p>
              <div className="mt-3 flex items-center gap-2">
                <div className="bg-surface-container h-2 flex-1 overflow-hidden">
                  <div
                    className="h-full bg-[#39ff88] transition-all duration-500"
                    style={{ width: `${ingestionData.summary.completionPercentage}%` }}
                  />
                </div>
                <span className="font-mono text-xs font-bold text-[#39ff88]">
                  {ingestionData.summary.completionPercentage}%
                </span>
              </div>
              <p className="text-muted-foreground mt-2 font-mono text-[11px]">
                {ingestionData.summary.pendingCount} active phones pending evidence
              </p>
            </div>

            {/* Card 2: Pending Ingestion Breakdown */}
            <div className="bg-background relative overflow-hidden p-6">
              <div className="flex items-center justify-between">
                <p className="meta-label text-[#ffe45e]">Pending Ingestion</p>
                <span className="size-2 rounded-full bg-[#ffe45e]" />
              </div>
              <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold text-[#ffe45e]">
                {ingestionData.summary.pendingCount}
              </p>
              <div className="mt-3 flex flex-wrap gap-1 font-mono text-[10px]">
                {ingestionData.summary.queuedCount > 0 ? (
                  <span className="border border-[#ffe45e]/40 bg-[#ffe45e]/10 px-1.5 py-0.5 text-[#ffe45e]">
                    {ingestionData.summary.queuedCount} Queued
                  </span>
                ) : null}
                {ingestionData.summary.quotaExhaustedCount > 0 ? (
                  <span className="border border-[#ff9f0a]/40 bg-[#ff9f0a]/10 px-1.5 py-0.5 text-[#ff9f0a]">
                    {ingestionData.summary.quotaExhaustedCount} Quota
                  </span>
                ) : null}
                {ingestionData.summary.emptyCorpusCount > 0 ? (
                  <span className="border border-zinc-500/40 bg-zinc-500/10 px-1.5 py-0.5 text-zinc-400">
                    {ingestionData.summary.emptyCorpusCount} Empty
                  </span>
                ) : null}
                {ingestionData.summary.failedCount > 0 ? (
                  <span className="border border-[#ff3b30]/40 bg-[#ff3b30]/10 px-1.5 py-0.5 text-[#ff3b30]">
                    {ingestionData.summary.failedCount} Failed
                  </span>
                ) : null}
              </div>
              <p className="text-muted-foreground mt-2 font-mono text-[11px]">
                Awaiting scraper, curation or quota reset
              </p>
            </div>

            {/* Card 3: Corpus Volume & Density */}
            <div className="bg-background relative overflow-hidden p-6">
              <div className="flex items-center justify-between">
                <p className="meta-label text-primary">Evidence Chunks</p>
                <span className="bg-primary size-2 rounded-full" />
              </div>
              <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold">
                {ingestionData.summary.totalChunks.toLocaleString('en-US')}
              </p>
              <p className="text-muted-foreground mt-3 font-mono text-xs">
                Across {ingestionData.summary.totalSources.toLocaleString('en-US')} review sources
              </p>
              <p className="text-primary mt-1 font-mono text-[11px]">
                Avg {ingestionData.summary.avgChunksPerPhone} chunks / phone
              </p>
            </div>

            {/* Card 4: Scorecard Synthesis */}
            <div className="bg-background relative overflow-hidden p-6">
              <div className="flex items-center justify-between">
                <p className="meta-label text-[#00d2ff]">Scorecards Synthesized</p>
                <span className="size-2 rounded-full bg-[#00d2ff]" />
              </div>
              <p className="font-display text-gradient-steel mt-3 text-5xl leading-none font-extrabold text-[#00d2ff]">
                {ingestionData.summary.totalActivePhones -
                  ingestionData.summary.scorecardMissingCount}
                <span className="text-muted-foreground text-2xl font-normal">
                  /{ingestionData.summary.totalActivePhones}
                </span>
              </p>
              <p className="text-muted-foreground mt-3 font-mono text-xs">
                7-aspect LLM scorecards computed
              </p>
              {ingestionData.summary.scorecardMissingCount > 0 ? (
                <p className="mt-1 font-mono text-[11px] text-[#00d2ff]">
                  {ingestionData.summary.scorecardMissingCount} phones awaiting aspect scoring
                </p>
              ) : (
                <p className="mt-1 font-mono text-[11px] text-[#39ff88]">100% scorecard coverage</p>
              )}
            </div>
          </section>

          {/* "Why Ingestion is Pending" Diagnostic Grid */}
          {ingestionData.pendingReasons.length > 0 ? (
            <section className="border-outline-variant bg-background mt-8 border p-6">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="size-4 text-[#ffe45e]" aria-hidden />
                    <h2 className="text-primary font-mono text-xs font-bold tracking-[0.14em] uppercase">
                      Why is Ingestion Pending? Root-Cause Diagnostics
                    </h2>
                  </div>
                  <p className="text-muted-foreground mt-1 text-xs">
                    Click any diagnostic reason below to instantly filter the phone ledger to
                    affected devices.
                  </p>
                </div>
                {reasonParam !== 'all' ? (
                  <Link
                    href={`/internal/database?view=ingestion&status=${statusParam}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                    className="text-accent font-mono text-xs tracking-[0.12em] uppercase hover:underline"
                  >
                    Clear reason filter ×
                  </Link>
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {ingestionData.pendingReasons.map(({ code, label, count, severity }) => {
                  const active = reasonParam.toLowerCase() === code.toLowerCase();
                  const colorClass =
                    severity === 'error'
                      ? 'border-[#ff3b30] text-[#ff3b30] bg-[#ff3b30]/10'
                      : severity === 'warning'
                        ? 'border-[#ff9f0a] text-[#ff9f0a] bg-[#ff9f0a]/10'
                        : 'border-[#00d2ff] text-[#00d2ff] bg-[#00d2ff]/10';

                  return (
                    <Link
                      key={code}
                      href={`/internal/database?view=ingestion&reason=${encodeURIComponent(code)}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                      className={`inline-flex items-center gap-2 border px-3 py-1.5 font-mono text-xs transition-colors ${
                        active
                          ? `${colorClass} font-bold shadow-sm`
                          : 'border-outline-variant bg-surface-container/40 text-muted-foreground hover:text-primary'
                      }`}
                    >
                      <span>{label}</span>
                      <span className="border-outline-variant bg-background px-1.5 py-0.5 text-[10px] font-bold">
                        {count}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Ingestion Filters and Search Bar */}
          <section className="border-outline-variant bg-background mt-8 border p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              {/* Status Tabs */}
              <div className="flex flex-wrap gap-1 font-mono text-xs uppercase">
                {[
                  {
                    id: 'all',
                    label: 'All Phones',
                    count: ingestionData.summary.totalActivePhones,
                  },
                  {
                    id: 'complete',
                    label: 'Complete',
                    count: ingestionData.summary.completedCount,
                  },
                  {
                    id: 'pending',
                    label: 'Pending Ingestion',
                    count: ingestionData.summary.pendingCount,
                  },
                  {
                    id: 'queued',
                    label: 'In Queue',
                    count: ingestionData.summary.queuedCount,
                  },
                  {
                    id: 'quota_exhausted',
                    label: 'Quota Blocked',
                    count: ingestionData.summary.quotaExhaustedCount,
                  },
                  {
                    id: 'failed',
                    label: 'Failed',
                    count: ingestionData.summary.failedCount,
                  },
                ].map((tab) => {
                  const active = statusParam === tab.id;
                  return (
                    <Link
                      key={tab.id}
                      href={`/internal/database?view=ingestion&status=${tab.id}&reason=${reasonParam}&brand=${brandParam}&search=${encodeURIComponent(searchParam)}`}
                      className={`border px-3 py-2 transition-colors ${
                        active
                          ? 'border-[#39ff88] bg-[#39ff88]/20 font-bold text-[#39ff88]'
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
                <input type="hidden" name="view" value="ingestion" />
                <input type="hidden" name="status" value={statusParam} />
                <input type="hidden" name="reason" value={reasonParam} />

                <div className="border-outline bg-background flex items-center gap-2 border px-3 py-1.5">
                  <Search className="text-muted-foreground size-3.5" aria-hidden />
                  <input
                    type="text"
                    name="search"
                    defaultValue={searchParam}
                    placeholder="Search phone name, model, issue..."
                    className="text-primary placeholder:text-muted-foreground/60 w-48 bg-transparent text-xs focus:outline-none sm:w-64"
                  />
                </div>

                <select
                  name="brand"
                  defaultValue={brandParam}
                  className="border-outline bg-background text-primary focus:border-accent border px-3 py-2 text-xs focus:outline-none"
                >
                  <option value="all">All Brands ({ingestionData.brands.length})</option>
                  {ingestionData.brands.map((b) => (
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
                    href="/internal/database?view=ingestion"
                    className="text-muted-foreground hover:text-primary border border-transparent px-2 py-2 text-[11px] tracking-[0.14em] uppercase"
                  >
                    Reset
                  </Link>
                ) : null}
              </form>
            </div>
          </section>

          {/* Phone Ingestion Ledger Table */}
          <section className="border-outline-variant bg-background mt-6 border">
            <div className="border-outline-variant flex items-center justify-between border-b p-4">
              <p className="meta-label text-primary">
                Showing {ingestionData.rows.length}{' '}
                {ingestionData.rows.length === 1 ? 'Phone' : 'Phones'}
              </p>
              <span className="text-muted-foreground font-mono text-xs">
                Catalog phones active for recommendation & retrieval
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] border-collapse text-left">
                <thead>
                  <tr className="border-outline-variant bg-surface-container/30 border-b">
                    {[
                      'Phone & Launch Tier',
                      'Ingestion Status',
                      'Why Pending? / Diagnostics',
                      'Evidence Progress',
                      'Ingest Timeline',
                      'Actions',
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
                  {ingestionData.rows.length > 0 ? (
                    ingestionData.rows.map((row) => (
                      <PhoneIngestionTableRow key={row.id} row={row} />
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="text-muted-foreground p-10 text-center text-sm">
                        No phones matched the selected filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
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
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                /phones/{device.phoneSlug}
              </Link>
            ) : null}
          </div>
        </div>
      </td>

      {/* Category & Status */}
      <td className="border-outline-variant border-r p-4">
        <div className="flex flex-col items-start gap-1.5">
          {categoryBadge(device.category, device.status)}
          {device.decision ? (
            <span className="text-muted-foreground font-mono text-[10px]">
              Decision: {device.decision}
            </span>
          ) : null}
        </div>
      </td>

      {/* Reason Blocked / Diagnostic */}
      <td className="border-outline-variant max-w-[340px] border-r p-4">
        {device.blockedReason || device.issueCodes.length > 0 ? (
          <div className="flex flex-col gap-1">
            {device.blockedReason ? (
              <span className="font-mono text-xs font-semibold text-[#ff3b30]">
                {device.blockedReason}
              </span>
            ) : null}
            {device.issueCodes.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {device.issueCodes.map((code) => (
                  <span
                    key={code}
                    className="py-0.2 border border-[#ff3b30]/30 bg-[#ff3b30]/10 px-1.5 font-mono text-[10px] text-[#ff3b30]"
                  >
                    {code}
                  </span>
                ))}
              </div>
            ) : null}
            {device.qualityIssues.length > 0 ? (
              <ul className="text-muted-foreground mt-1 space-y-0.5 font-mono text-[10px]">
                {device.qualityIssues.slice(0, 2).map((qi, idx) => (
                  <li key={idx} className="line-clamp-1">
                    • {qi.code}: {qi.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground/60 font-mono text-xs">— None (Healthy) —</span>
        )}
      </td>

      {/* Source */}
      <td className="border-outline-variant border-r p-4 font-mono text-xs">
        <div className="flex flex-col gap-1">
          <span className="text-primary font-bold uppercase">{device.sourceKey}</span>
          {device.sourceUrl ? (
            <a
              href={device.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-accent flex items-center gap-1 text-[11px] hover:underline"
            >
              <span className="max-w-[140px] truncate">{device.sourceUrl}</span>
              <ExternalLink className="size-2.5 shrink-0" aria-hidden />
            </a>
          ) : null}
          {device.confidence ? (
            <span className="text-muted-foreground text-[10px]">
              Conf: {Math.round(Number(device.confidence) * 100)}%
            </span>
          ) : null}
        </div>
      </td>

      {/* Updated */}
      <td className="text-muted-foreground p-4 font-mono text-xs">
        <div className="flex flex-col gap-1">
          <span>{device.updatedAt.slice(0, 10)}</span>
          <span className="text-[10px]">{device.updatedAt.slice(11, 16)} UTC</span>
          {device.attempts > 0 ? (
            <span className="text-[10px]">Attempts: {device.attempts}</span>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function PhoneIngestionTableRow({ row }: { readonly row: PhoneIngestionRow }) {
  const isPending = !row.isComplete;

  return (
    <tr
      className={`border-outline-variant hover:bg-surface-container/50 border-b transition-colors last:border-b-0 ${
        row.statusCategory === 'failed'
          ? 'bg-[#ff3b30]/5'
          : row.statusCategory === 'quota_exhausted'
            ? 'bg-[#ff9f0a]/5'
            : isPending
              ? 'bg-[#ffe45e]/5'
              : ''
      }`}
    >
      {/* Phone Name & Tier */}
      <td className="border-outline-variant max-w-[260px] border-r p-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-primary text-sm leading-snug font-bold">{row.model}</span>
            {tierBadge(row.tier)}
          </div>
          <div className="text-muted-foreground mt-1 flex items-center gap-2 font-mono text-[11px]">
            <span className="text-primary font-semibold">{row.brand}</span>
            <span>•</span>
            <span className="text-muted-foreground/80">{row.slug}</span>
          </div>
          {row.launchDate ? (
            <span className="text-muted-foreground mt-1 font-mono text-[10px]">
              Launched: {row.launchDate}
            </span>
          ) : null}
        </div>
      </td>

      {/* Ingestion Status Badge */}
      <td className="border-outline-variant border-r p-4">
        <div className="flex flex-col items-start gap-1.5">
          {ingestionStatusBadge(row.statusCategory, row.isOverdue)}
          {row.queueInfo ? (
            <span className="text-muted-foreground font-mono text-[10px]">
              Queue: {row.queueInfo.status}
            </span>
          ) : null}
        </div>
      </td>

      {/* Why Pending? / Diagnostics */}
      <td className="border-outline-variant max-w-[340px] border-r p-4">
        {row.isComplete ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#39ff88]">
              <CheckCircle2 className="size-3.5" />
              <span>Evidence Ingestion Complete</span>
            </div>
            {row.isOverdue ? (
              <span className="font-mono text-[10px] text-[#ff9f0a]">
                ⚠ Overdue for scheduled freshness re-crawl
              </span>
            ) : (
              <span className="text-muted-foreground font-mono text-[10px]">
                Ready for RAG retrieval & recommendation
              </span>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-primary text-xs leading-tight font-bold">
              {row.pendingReason?.label || 'Pending Ingestion'}
            </span>
            <p className="text-muted-foreground text-[11px] leading-snug">
              {row.pendingReason?.description}
            </p>
            {row.pendingReason?.errorDetail ? (
              <span className="mt-1 line-clamp-2 border border-[#ff3b30]/30 bg-[#ff3b30]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#ff3b30]">
                {row.pendingReason.errorDetail}
              </span>
            ) : null}
            {row.queueInfo ? (
              <span className="border-outline-variant bg-surface-container/60 text-muted-foreground px-1.5 py-0.5 font-mono text-[10px]">
                Adapter: {row.queueInfo.adapter} • Attempts: {row.queueInfo.attempts}
              </span>
            ) : null}
          </div>
        )}
      </td>

      {/* Evidence Progress */}
      <td className="border-outline-variant border-r p-4 font-mono text-xs">
        <div className="flex flex-col gap-1.5 font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`flex items-center gap-1 ${
                row.hasSpecEmbedding ? 'text-[#39ff88]' : 'text-muted-foreground/60'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  row.hasSpecEmbedding ? 'bg-[#39ff88]' : 'bg-zinc-600'
                }`}
              />
              Vector {row.hasSpecEmbedding ? '✓' : '✗'}
            </span>
            <span>•</span>
            <span
              className={`flex items-center gap-1 ${
                row.sourceCount > 0 ? 'text-[#39ff88]' : 'text-muted-foreground/60'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  row.sourceCount > 0 ? 'bg-[#39ff88]' : 'bg-zinc-600'
                }`}
              />
              {row.sourceCount} {row.sourceCount === 1 ? 'src' : 'srcs'}
            </span>
            <span>•</span>
            <span
              className={`flex items-center gap-1 ${
                row.chunkCount >= 5
                  ? 'text-[#39ff88]'
                  : row.chunkCount > 0
                    ? 'text-[#ffe45e]'
                    : 'text-[#ff3b30]'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  row.chunkCount >= 5
                    ? 'bg-[#39ff88]'
                    : row.chunkCount > 0
                      ? 'bg-[#ffe45e]'
                      : 'bg-[#ff3b30]'
                }`}
              />
              {row.chunkCount} chunks
            </span>
            <span>•</span>
            <span
              className={`flex items-center gap-1 ${
                row.aspectCount >= 5
                  ? 'text-[#39ff88]'
                  : row.aspectCount > 0
                    ? 'text-[#ffe45e]'
                    : 'text-muted-foreground/60'
              }`}
            >
              <span
                className={`size-1.5 rounded-full ${
                  row.aspectCount >= 5
                    ? 'bg-[#39ff88]'
                    : row.aspectCount > 0
                      ? 'bg-[#ffe45e]'
                      : 'bg-zinc-600'
                }`}
              />
              {row.aspectCount}/7 aspects
            </span>
          </div>
        </div>
      </td>

      {/* Ingest Timeline */}
      <td className="border-outline-variant text-muted-foreground border-r p-4 font-mono text-xs">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase">Last:</span>
            <span className="text-primary font-bold">
              {row.lastIngestAt ? row.lastIngestAt.slice(0, 10) : 'Never'}
            </span>
          </div>
          {row.nextIngestAt ? (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span>Next:</span>
              <span className={row.isOverdue ? 'font-bold text-[#ff9f0a]' : ''}>
                {row.nextIngestAt.slice(0, 10)}
              </span>
            </div>
          ) : null}
        </div>
      </td>

      {/* Actions */}
      <td className="p-4 font-mono text-xs">
        <div className="flex items-center gap-2">
          <Link
            href={`/internal/lifecycle?phone=${row.slug}`}
            className="border-outline text-primary hover:border-accent hover:text-accent flex items-center gap-1.5 border px-2.5 py-1.5 text-[11px] tracking-[0.1em] uppercase transition-colors"
          >
            <span>Probe</span>
            <ArrowRight className="size-3" aria-hidden />
          </Link>
          <Link
            href={`/p/${row.slug}`}
            target="_blank"
            rel="noreferrer"
            className="border-outline-variant text-muted-foreground hover:text-foreground hover:border-accent border p-1.5 transition-colors"
            title="Open Public Phone Page"
          >
            <ExternalLink className="size-3" aria-hidden />
          </Link>
        </div>
      </td>
    </tr>
  );
}

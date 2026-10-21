'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { InternalRefreshButton } from '@/app/internal/_components/internal-refresh-button';
import {
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Gauge,
  Play,
  RefreshCw,
  Search,
  Upload,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Sliders,
  ShieldAlert,
  MessageSquare,
} from 'lucide-react';
import { toast } from 'sonner';
import type { BenchmarkRunRecord, BenchmarkResultItem } from '@/services/eval/types';
import { BenchmarkReportSchema } from '@/services/eval/export/report-schema';
import { CampaignEvidence } from './campaign-evidence';

function formatBenchmarkDate(value: string | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatBenchmarkTime(value: string | Date): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} UTC`;
}

interface EvalClientViewProps {
  readonly initialRuns: readonly BenchmarkRunRecord[];
  readonly initialError?: string | null;
}

export function EvalClientView({ initialRuns, initialError }: EvalClientViewProps) {
  const [runs, setRuns] = useState<readonly BenchmarkRunRecord[]>(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [selectedRunDetails, setSelectedRunDetails] = useState<BenchmarkRunRecord | null>(null);

  // Runner controls
  const [selectedSuite, setSelectedSuite] = useState<
    'recsys' | 'rag' | 'load-stress' | 'multi-turn' | 'all'
  >('recsys');
  const [providerTrack, setProviderTrack] = useState<'stub' | 'live'>('stub');
  const [accessToken, setAccessToken] = useState('');
  const [historyError, setHistoryError] = useState<string | null>(initialError ?? null);
  const [preflightReport, setPreflightReport] = useState<Record<string, unknown> | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [campaign, setCampaign] = useState<Record<string, unknown> | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [concurrencyVus, setConcurrencyVus] = useState<number>(10);
  const [totalRequests, setTotalRequests] = useState<number>(100);
  const [sampleScale, setSampleScale] = useState<'quick' | 'full'>('full');

  // Live progress
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [progressStep, setProgressStep] = useState<number>(0);
  const [progressTotal, setProgressTotal] = useState<number>(0);
  const [activeTestLabel, setActiveTestLabel] = useState<string>('');
  const [liveQps, setLiveQps] = useState<number | null>(null);

  // Inspector modal/drawer
  const [inspectItem, setInspectItem] = useState<BenchmarkResultItem | null>(null);

  // Filter & search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Regression comparison mode
  const [compareBaselineId, setCompareBaselineId] = useState<string | null>(null);

  // Active Hub Tab
  const [activeTab, setActiveTab] = useState<'benchmarks' | 'diagnostics' | 'campaign'>(
    'benchmarks',
  );

  const scrollToTestCases = (category?: string, status?: string) => {
    if (category) setCategoryFilter(category);
    if (status) setStatusFilter(status);
    setActiveTab('benchmarks');
    const el = document.getElementById('eval-test-cases-table');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const reviewInputRef = useRef<HTMLInputElement>(null);
  const loadCampaign = async () => {
    try {
      const response = await fetch('/api/internal/eval/campaign', {
        headers: accessToken ? { 'x-recsy-eval-token': accessToken } : {},
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Campaign artifacts could not be loaded');
      setCampaign(data.summary);
      setCampaignError(null);
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : String(error));
    }
  };
  const downloadReview = async () => {
    try {
      const response = await fetch('/api/internal/eval/campaign?artifact=review', {
        headers: accessToken ? { 'x-recsy-eval-token': accessToken } : {},
      });
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Review package is unavailable');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'recsy-blinded-review.html';
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : String(error));
    }
  };
  const importReview = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const response = await fetch('/api/internal/eval/campaign', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { 'x-recsy-eval-token': accessToken } : {}),
        },
        body: await file.text(),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Review import failed');
      setCampaign(data.summary);
      setCampaignError(null);
    } catch (error) {
      setCampaignError(error instanceof Error ? error.message : String(error));
    }
    event.target.value = '';
  };

  useEffect(() => {
    const firstRunId = initialRuns[0]?.id;
    if (!firstRunId) return;
    let cancelled = false;
    fetch(`/api/internal/eval/runs/${firstRunId}`)
      .then(async (res) => {
        const data = (await res.json()) as { run?: BenchmarkRunRecord; error?: string };
        if (!res.ok || !data.run)
          throw new Error(data.error ?? `Run details failed (HTTP ${res.status})`);
        if (!cancelled) setSelectedRunDetails(data.run);
      })
      .catch((error) => {
        if (!cancelled) setHistoryError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [initialRuns]);

  // Load run details when clicked
  const handleSelectRun = async (runId: string) => {
    setSelectedRunId(runId);
    try {
      const res = await fetch(`/api/internal/eval/runs/${runId}`, {
        headers: accessToken ? { 'x-recsy-eval-token': accessToken } : {},
      });
      const data = (await res.json()) as { run?: BenchmarkRunRecord; error?: string };
      if (!res.ok || !data.run)
        throw new Error(data.error ?? `Run details failed (HTTP ${res.status})`);
      setSelectedRunDetails(data.run);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLoadHistory = async () => {
    try {
      const res = await fetch('/api/internal/eval/runs', {
        headers: accessToken ? { 'x-recsy-eval-token': accessToken } : {},
      });
      const data = (await res.json()) as { runs?: BenchmarkRunRecord[]; error?: string };
      if (!res.ok || !data.runs)
        throw new Error(data.error ?? `Run history failed (HTTP ${res.status})`);
      setRuns(data.runs);
      setHistoryError(null);
      if (data.runs[0]) await handleSelectRun(data.runs[0].id);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : String(error));
    }
  };

  // Run benchmark suite
  const handleExecuteBenchmark = async () => {
    setRunError(null);
    setIsRunning(true);
    setProgressStep(0);
    setProgressTotal(sampleScale === 'quick' ? 5 : 30);
    setActiveTestLabel('Initializing benchmark runner...');
    setLiveQps(null);

    try {
      const res = await fetch('/api/internal/eval/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'x-recsy-eval-token': accessToken } : {}),
        },
        body: JSON.stringify({
          suite: selectedSuite,
          providerTrack,
          concurrencyVus,
          ...(selectedSuite === 'load-stress' ? { totalRequests } : {}),
          sampleScale,
        }),
      });

      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Failed to start benchmark stream (HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let terminalEvent = false;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: {
            type?: string;
            step?: number;
            total?: number;
            activeTest?: string;
            interimQps?: number;
            run?: BenchmarkRunRecord;
            message?: string;
          };
          try {
            event = JSON.parse(line);
          } catch {
            throw new Error(`Malformed benchmark stream event: ${line.slice(0, 120)}`);
          }
          if (event.type === 'progress') {
            setProgressStep(event.step ?? 0);
            setProgressTotal(event.total ?? 0);
            setActiveTestLabel(event.activeTest ?? 'Running');
            if (event.interimQps != null) setLiveQps(event.interimQps);
          } else if (event.type === 'done' && event.run) {
            const completedRun = event.run;
            terminalEvent = true;
            if (completedRun.status === 'success')
              toast.success('Benchmark completed; inspect run boundary and evidence');
            else
              toast.error(
                `Benchmark completed with ${completedRun.failedTests} non-passing attempts`,
              );
            setRuns((prev) => [completedRun, ...prev]);
            setSelectedRunId(completedRun.id);
            setSelectedRunDetails(completedRun);
          } else if (event.type === 'error') {
            terminalEvent = true;
            throw new Error(event.message ?? 'Benchmark failed without a diagnostic');
          }
        }
      }
      if (!terminalEvent) throw new Error('Benchmark stream ended without a final result');
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setRunError(errorMsg);
      toast.error(`Execution error: ${errorMsg}`);
    } finally {
      setIsRunning(false);
    }
  };

  const handlePreflight = async () => {
    setRunError(null);
    setPreflightReport(null);
    try {
      const params = new URLSearchParams({ suite: selectedSuite, sampleScale });
      const res = await fetch(`/api/internal/eval/preflight?${params}`, {
        headers: accessToken ? { 'x-recsy-eval-token': accessToken } : {},
      });
      const data = (await res.json()) as {
        ready: boolean;
        report?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok || !data.ready || !data.report)
        throw new Error(data.error ?? `Preflight failed (HTTP ${res.status})`);
      setPreflightReport(data.report);
      toast.success('Fixtures, catalog, and selected corpus are ready');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRunError(message);
      toast.error(message);
    }
  };

  // Export current run as JSON
  const handleExportJson = () => {
    if (!selectedRunDetails) {
      toast.error('No benchmark run selected for export');
      return;
    }

    const payload = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      systemInfo: {
        nodeVersion:
          typeof selectedRunDetails.config?.nodeVersion === 'string'
            ? selectedRunDetails.config.nodeVersion
            : 'unrecorded',
        commitHash: selectedRunDetails.commitHash,
        environment: 'RECSY evaluation; see run.config for provider and boundary',
      },
      run: {
        id: selectedRunDetails.id,
        suiteName: selectedRunDetails.suiteName,
        tier: selectedRunDetails.tier,
        concurrencyVus: selectedRunDetails.concurrencyVus,
        durationMs: selectedRunDetails.durationMs,
        status: selectedRunDetails.status,
        totalTests: selectedRunDetails.totalTests,
        passedTests: selectedRunDetails.passedTests,
        failedTests: selectedRunDetails.failedTests,
        metricsSummary: selectedRunDetails.metricsSummary ?? {},
        config: selectedRunDetails.config,
        createdAt: String(selectedRunDetails.createdAt),
      },
      results: (selectedRunDetails.results ?? []).map((r) => ({
        id: r.id,
        testCaseId: r.testCaseId,
        category: r.category,
        inputQuery: r.inputQuery,
        status: r.status,
        latencyMs: r.latencyMs,
        scores: r.scores,
        tracePayload: r.tracePayload,
        errorDetails: r.errorDetails,
      })),
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recsy-benchmark-${selectedRunDetails.tier.toLowerCase()}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Benchmark JSON report exported successfully');
  };

  // Export current run as CSV
  const handleExportCsv = () => {
    if (!selectedRunDetails || !selectedRunDetails.results) {
      toast.error('No benchmark results to export');
      return;
    }

    const headers = [
      'test_case_id',
      'category',
      'status',
      'latency_ms',
      'input_query',
      'ndcg3',
      'mrr',
      'cite_prec',
      'cite_rec',
      'phantom_rate',
      'error_details',
    ];

    const rows = selectedRunDetails.results.map((r) => [
      `"${r.testCaseId}"`,
      `"${r.category}"`,
      `"${r.status}"`,
      r.latencyMs,
      `"${r.inputQuery.replace(/"/g, '""')}"`,
      r.scores.ndcg3 ?? '',
      r.scores.mrr ?? '',
      r.scores.citePrec ?? '',
      r.scores.citeRec ?? '',
      r.scores.phantomRate ?? '',
      `"${(r.errorDetails ?? '').replace(/"/g, '""')}"`,
    ]);

    const csvContent = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recsy-benchmark-results-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Benchmark CSV exported');
  };

  // Import JSON report & rehydrate UI
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const rawJson = JSON.parse(text);

      const parsed = BenchmarkReportSchema.parse(rawJson);

      const res = await fetch('/api/internal/eval/import', {
        method: 'POST',
        body: JSON.stringify(parsed),
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { 'x-recsy-eval-token': accessToken } : {}),
        },
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? `Import rejected (HTTP ${res.status})`);
      }

      const data = await res.json();
      toast.success('Report imported as unverified evidence');
      setRuns((prev) => [data.run, ...prev]);
      setSelectedRunId(data.run.id);
      setSelectedRunDetails(data.run);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      toast.error(`Import failed: ${errorMsg}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const currentSummary = selectedRunDetails?.metricsSummary;
  const filteredResults = (selectedRunDetails?.results ?? []).filter((r) => {
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        r.testCaseId.toLowerCase().includes(q) ||
        r.inputQuery.toLowerCase().includes(q) ||
        (r.errorDetails && r.errorDetails.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const baselineRun = runs.find((r) => r.id === compareBaselineId);
  const baselineComparable = Boolean(
    baselineRun &&
    selectedRunDetails &&
    baselineRun.config?.suite === selectedRunDetails.config?.suite &&
    baselineRun.config?.providerTrack === selectedRunDetails.config?.providerTrack &&
    JSON.stringify(baselineRun.config?.preflight ?? null) ===
      JSON.stringify(selectedRunDetails.config?.preflight ?? null) &&
    baselineRun.config?.preflight != null,
  );
  const selectedLoadTrace = selectedRunDetails?.results?.find(
    (result) => result.category === 'stress',
  )?.tracePayload?.loadStress;
  const loadStages = Object.entries(selectedLoadTrace?.stageP95Ms ?? {}).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <div className="flex-1 space-y-6 p-6 font-sans lg:p-8">
      {/* ------------------------------------------------------------------ */}
      {/* Header & Meta                                                      */}
      {/* ------------------------------------------------------------------ */}
      <div className="border-border/40 flex flex-col gap-5 border-b pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Link
                href="/internal/command-center"
                className="text-muted-foreground hover:text-primary font-mono text-xs tracking-[0.14em] uppercase transition-colors"
              >
                ← Command Center
              </Link>
              <span className="text-muted-foreground/40 font-mono text-xs">/</span>
              <span className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                Evaluation Hub
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <h1 className="text-foreground flex items-center gap-2 font-mono text-3xl font-extrabold tracking-tight uppercase sm:text-4xl">
                <Gauge className="text-primary h-7 w-7" />
                Evaluation & Benchmarks
              </h1>
              <span className="bg-primary/10 text-primary border-primary/20 rounded border px-2 py-0.5 font-mono text-xs font-semibold">
                Boundary Verified
              </span>
            </div>
            <p className="text-muted-foreground mt-2 font-mono text-xs tracking-[0.12em] uppercase">
              Component benchmarks, conversational CRS, lexical citations, and capacity probes
            </p>
          </div>

          {/* Quick Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <InternalRefreshButton
              label="Refresh Hub"
              className="border-border/80 bg-background/60 hover:bg-muted flex cursor-pointer items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-xs font-medium transition-colors"
            />
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImportFile}
              accept=".json"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="border-border/80 bg-background/60 hover:bg-muted flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-xs font-medium transition-colors"
            >
              <Upload className="h-3 w-3" />
              Import JSON
            </button>
            <button
              onClick={handleExportCsv}
              disabled={!selectedRunDetails}
              className="border-border/80 bg-background/60 hover:bg-muted flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-xs font-medium transition-colors disabled:opacity-40"
            >
              <FileText className="h-3 w-3" />
              Export CSV
            </button>
            <button
              onClick={handleExportJson}
              disabled={!selectedRunDetails}
              className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs font-medium shadow-sm transition-colors disabled:opacity-40"
            >
              <Download className="h-3 w-3" />
              Export Report
            </button>
          </div>
        </div>

        {/* Compact Toolbar: Access Token, Provider Track, Preflight Check */}
        <div className="border-border/60 bg-muted/20 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 font-mono text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label
                htmlFor="eval-access-token"
                className="text-muted-foreground text-[11px] uppercase"
              >
                Access Token:
              </label>
              <input
                id="eval-access-token"
                type="password"
                autoComplete="off"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Production token"
                className="border-border bg-background text-foreground focus:ring-primary w-40 rounded border px-2.5 py-1 text-xs focus:ring-1 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleLoadHistory}
                className="border-border bg-background hover:bg-muted rounded border px-2.5 py-1 text-[11px] uppercase transition-colors"
              >
                Load Runs
              </button>
            </div>

            <div className="flex items-center gap-2">
              <label
                htmlFor="eval-provider-track"
                className="text-muted-foreground text-[11px] uppercase"
              >
                Provider:
              </label>
              <select
                id="eval-provider-track"
                value={providerTrack}
                disabled={isRunning}
                onChange={(e) => setProviderTrack(e.target.value as 'stub' | 'live')}
                className="border-border bg-background text-foreground focus:ring-primary rounded border px-2 py-1 text-xs focus:ring-1 focus:outline-none"
              >
                <option value="stub">Deterministic Stub (Dev)</option>
                <option value="live">Configured Live Provider</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            onClick={handlePreflight}
            disabled={isRunning}
            className="border-border bg-background hover:bg-muted rounded border px-3 py-1 text-[11px] uppercase transition-colors disabled:opacity-50"
          >
            Preflight Check
          </button>
        </div>

        {historyError && (
          <div
            role="alert"
            className="rounded border border-amber-500/40 bg-amber-500/10 p-3 font-mono text-xs text-amber-600"
          >
            {historyError}
          </div>
        )}
        {runError && (
          <div
            role="alert"
            className="rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-500"
          >
            {runError}
          </div>
        )}

        {/* 3 Nav Tabs */}
        <div className="border-border/40 flex flex-wrap gap-1 border-b font-mono text-xs uppercase">
          <button
            onClick={() => setActiveTab('benchmarks')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-bold transition-colors ${
              activeTab === 'benchmarks'
                ? 'border-primary text-primary bg-primary/5'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            <span>1. Benchmarks & Results</span>
            <span className="bg-muted/60 py-0.2 rounded px-1.5 text-[10px]">{runs.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('diagnostics')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-bold transition-colors ${
              activeTab === 'diagnostics'
                ? 'border-primary text-primary bg-primary/5'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            <span>2. Telemetry & Diagnostics</span>
            {selectedRunDetails && (
              <span className="bg-primary/10 text-primary py-0.2 rounded px-1.5 text-[10px]">
                {selectedRunDetails.passedTests}/{selectedRunDetails.totalTests} Pass
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('campaign')}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 font-bold transition-colors ${
              activeTab === 'campaign'
                ? 'border-primary text-primary bg-primary/5'
                : 'text-muted-foreground hover:text-foreground border-transparent'
            }`}
          >
            <span>3. Campaign Evidence & Gates</span>
            {campaign && (
              <span className="py-0.2 rounded bg-emerald-500/10 px-1.5 text-[10px] text-emerald-500">
                Loaded
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'benchmarks' && (
        <div className="space-y-6">
          {/* ------------------------------------------------------------------ */}
          {/* Interactive Control Rail                                           */}
          {/* ------------------------------------------------------------------ */}
          <div className="border-border/60 bg-card/60 space-y-4 rounded-lg border p-5 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-muted-foreground flex items-center gap-2 font-mono text-sm font-semibold tracking-wider uppercase">
                <Sliders className="text-primary h-4 w-4" />
                Benchmark Execution Controls
              </h2>
              {isRunning && (
                <span className="text-primary flex animate-pulse items-center gap-2 font-mono text-xs font-semibold">
                  <span className="bg-primary h-2 w-2 rounded-full" />
                  RUNNING IN-PROGRESS
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
              {/* Suite Selector */}
              <div>
                <label className="text-muted-foreground mb-1 block font-mono text-xs">
                  Benchmark Suite
                </label>
                <select
                  value={selectedSuite}
                  onChange={(e) => {
                    const s = e.target.value as
                      | 'recsys'
                      | 'rag'
                      | 'load-stress'
                      | 'multi-turn'
                      | 'all';
                    setSelectedSuite(s);
                    setPreflightReport(null);
                  }}
                  disabled={isRunning}
                  className="border-border bg-background text-foreground focus:ring-primary w-full rounded border px-3 py-2 font-mono text-xs focus:ring-1 focus:outline-none"
                >
                  <option value="recsys">Ranker consistency and constraint checks</option>
                  <option value="multi-turn">Multi-Turn Conversational CRS (JGA, CRR, CSR)</option>
                  <option value="rag">Q&A citation and lexical proxy checks</option>
                  <option value="load-stress">DB retrieval component load (1-100 workers)</option>
                  <option value="all">Full Comprehensive Suite</option>
                </select>
              </div>

              {/* Concurrency Level */}
              {selectedSuite === 'load-stress' && (
                <div>
                  <label className="text-muted-foreground mb-1 block font-mono text-xs">
                    Concurrent workers (DB load probe)
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[1, 5, 10, 25, 50, 100].map((vu) => (
                      <button
                        key={vu}
                        onClick={() => setConcurrencyVus(vu)}
                        disabled={isRunning}
                        className={`flex-1 rounded border py-1.5 font-mono text-xs font-medium transition-colors ${
                          concurrencyVus === vu
                            ? 'border-primary bg-primary/10 text-primary font-bold'
                            : 'border-border/60 hover:bg-muted text-muted-foreground'
                        }`}
                      >
                        {vu}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Dataset Scale */}
              <div>
                <label className="text-muted-foreground mb-1 block font-mono text-xs">
                  Dataset Scale
                </label>
                <select
                  value={sampleScale}
                  onChange={(e) => setSampleScale(e.target.value as 'quick' | 'full')}
                  disabled={isRunning}
                  className="border-border bg-background text-foreground focus:ring-primary w-full rounded border px-3 py-2 font-mono text-xs focus:ring-1 focus:outline-none"
                >
                  <option value="full">
                    Full authored fixture set (30 personas, 20 Q&A, 15 conversations)
                  </option>
                  <option value="quick">Quick subset (5 personas or Q&A, 3 conversations)</option>
                </select>
              </div>
              {selectedSuite === 'load-stress' && (
                <div>
                  <label
                    htmlFor="eval-total-requests"
                    className="text-muted-foreground mb-1 block font-mono text-xs"
                  >
                    Completed attempts (1–10,000)
                  </label>
                  <input
                    id="eval-total-requests"
                    type="number"
                    min={1}
                    max={10000}
                    value={totalRequests}
                    disabled={isRunning}
                    onChange={(e) => setTotalRequests(Number(e.target.value))}
                    className="border-border bg-background w-full rounded border px-3 py-2 font-mono text-xs"
                  />
                </div>
              )}

              {/* Run Button */}
              <div className="flex items-end">
                <button
                  onClick={handleExecuteBenchmark}
                  disabled={isRunning}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 flex w-full items-center justify-center gap-2 rounded px-4 py-2.5 font-mono text-xs font-bold shadow-md transition-all disabled:opacity-50"
                >
                  {isRunning ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Executing...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 fill-current" />
                      Execute Benchmark Suite
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Live Progress Banner */}
            {isRunning && (
              <div className="border-primary/30 bg-primary/5 space-y-2 rounded border p-3">
                <div className="flex items-center justify-between font-mono text-xs">
                  <span className="text-primary font-semibold">{activeTestLabel}</span>
                  <span className="text-muted-foreground">
                    {progressStep} / {progressTotal} (
                    {Math.round((progressStep / (progressTotal || 1)) * 100)}%)
                    {liveQps && (
                      <span className="text-primary ml-2 font-bold">| QPS: {liveQps}</span>
                    )}
                  </span>
                </div>
                <div className="bg-border/40 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, Math.round((progressStep / (progressTotal || 1)) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Primary KPI Metric Cards (with 95% Bootstrap CIs)                   */}
          {/* ------------------------------------------------------------------ */}
          {currentSummary?.jointGoalAccuracy != null ||
          selectedRunDetails?.tier === 'MULTI_TURN_CRS' ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {/* Multi-Turn 1: Joint Goal Accuracy (JGA) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('multi-turn')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('multi-turn')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Joint Goal Accuracy (JGA)
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.jointGoalAccuracy?.mean != null
                      ? `${(currentSummary.jointGoalAccuracy.mean * 100).toFixed(1)}%`
                      : '--'}
                  </p>
                  {currentSummary?.jointGoalAccuracy?.ci95 && (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      ±
                      {(
                        ((currentSummary.jointGoalAccuracy.ci95[1] -
                          currentSummary.jointGoalAccuracy.ci95[0]) /
                          2) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  )}
                </div>
                <p className="font-mono text-[10px] font-medium text-emerald-500">
                  Exact match on annotated slots; see trace for unchecked fields
                </p>
              </div>

              {/* Multi-Turn 2: Constraint Retention Rate (CRR) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('multi-turn')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('multi-turn')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Constraint Retention (CRR)
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.constraintRetentionRate?.mean != null
                      ? `${(currentSummary.constraintRetentionRate.mean * 100).toFixed(1)}%`
                      : '--'}
                  </p>
                  {currentSummary?.constraintRetentionRate?.ci95 && (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      ±
                      {(
                        ((currentSummary.constraintRetentionRate.ci95[1] -
                          currentSummary.constraintRetentionRate.ci95[0]) /
                          2) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  )}
                </div>
                <p className="font-mono text-[10px] font-medium text-emerald-500">
                  Eligible annotated retention checks only
                </p>
              </div>

              {/* Multi-Turn 3: Constraint Mutation Latency */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('multi-turn')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('multi-turn')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Mutation Responsiveness
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.mutationResponsiveness != null
                      ? `${(currentSummary.mutationResponsiveness * 100).toFixed(1)}%`
                      : '--'}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  0-Turn Latency (Immediate Pivot)
                </p>
              </div>

              {/* Multi-Turn 4: Multi-Turn Policy CSR */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('multi-turn')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('multi-turn')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Multi-Turn Policy CSR
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.multiTurnCsr != null
                      ? `${(currentSummary.multiTurnCsr * 100).toFixed(1)}%`
                      : '--'}
                  </p>
                </div>
                <p className="font-mono text-[10px] font-medium text-emerald-500">
                  Hard Constraint Pass Rate
                </p>
              </div>

              {/* Multi-Turn 5: Refine Intent F1 & Reset */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('multi-turn')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('multi-turn')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Refine F1 & Reset Clean
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.refineIntentF1 != null
                      ? `${(currentSummary.refineIntentF1 * 100).toFixed(0)}%`
                      : '--'}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  Reset Clean:{' '}
                  {currentSummary?.resetCleanliness != null
                    ? `${(currentSummary.resetCleanliness * 100).toFixed(0)}%`
                    : '--'}
                </p>
              </div>

              {/* Multi-Turn 6: Token Usage & Cost */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('multi-turn')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('multi-turn')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Provider-reported generation tokens
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.tokenUsage?.totalTokens != null
                      ? currentSummary.tokenUsage.totalTokens.toLocaleString()
                      : '--'}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  In: {currentSummary?.tokenUsage?.tokensIn?.toLocaleString() ?? '--'}; retrieval
                  tokens not included
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {/* Metric 1: NDCG@3 */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('recsys')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('recsys')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    MAUT agreement NDCG@3
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.ndcg3?.mean != null
                      ? currentSummary.ndcg3.mean.toFixed(3)
                      : '--'}
                  </p>
                  {currentSummary?.ndcg3?.ci95 && (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      ±
                      {((currentSummary.ndcg3.ci95[1] - currentSummary.ndcg3.ci95[0]) / 2).toFixed(
                        3,
                      )}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  Labels derive from ranker rules; not independent relevance
                </p>
              </div>

              {/* Metric 2: lexical citation proxy */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('rag')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('rag')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Lexical citation support proxy
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.citePrec?.mean != null
                      ? `${(currentSummary.citePrec.mean * 100).toFixed(1)}%`
                      : '--'}
                  </p>
                  {currentSummary?.citePrec?.ci95 && (
                    <span className="text-muted-foreground font-mono text-[10px]">
                      ±
                      {(
                        ((currentSummary.citePrec.ci95[1] - currentSummary.citePrec.ci95[0]) / 2) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  Word overlap is not semantic entailment
                </p>
              </div>

              {/* Metric 3: Tail Latency p95 */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('all')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('all')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Tail Latency (p95)
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.latencyP95 != null ? `${currentSummary.latencyP95} ms` : '--'}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  p50: {currentSummary?.latencyP50 ?? '--'}ms | p99:{' '}
                  {currentSummary?.latencyP99 ?? '--'}ms
                </p>
              </div>

              {/* Metric 4: Budget & Dealbreaker CSR */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('recsys')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('recsys')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Constraint Policy CSR
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.budgetCsr != null
                      ? `${(currentSummary.budgetCsr * 100).toFixed(1)}%`
                      : '--'}
                  </p>
                </div>
                <p className="font-mono text-[10px] font-medium text-emerald-500">
                  Dealbreaker keyword checks:{' '}
                  {currentSummary?.dealbreakerCsr != null
                    ? `${(currentSummary.dealbreakerCsr * 100).toFixed(1)}%`
                    : '--'}
                </p>
                {currentSummary?.constraintPolicyCases != null && (
                  <p className="text-muted-foreground font-mono text-[10px]">
                    Answerable policy cases: {currentSummary.constraintPolicyCases}
                  </p>
                )}
                {currentSummary?.noResultPolicyCases != null &&
                  currentSummary.noResultPolicyCases > 0 && (
                    <p className="text-muted-foreground font-mono text-[10px]">
                      Expected no-result cases: {currentSummary.noResultPolicyPassed ?? 0}/
                      {currentSummary.noResultPolicyCases}
                    </p>
                  )}
              </div>

              {/* Metric 5: Intra-List Diversity (ILD) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('recsys')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('recsys')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Intra-List Div (ILD@3)
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.ild3?.mean != null
                      ? currentSummary.ild3.mean.toFixed(3)
                      : '--'}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  Embedding coverage: {currentSummary?.ildCoverageCases ?? '--'} cases
                </p>
              </div>

              {/* Metric 6: Gini Index & Coverage */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => scrollToTestCases('recsys')}
                onKeyDown={(e) => e.key === 'Enter' && scrollToTestCases('recsys')}
                className="border-border/60 bg-card hover:border-primary/80 hover:bg-muted/20 group cursor-pointer space-y-1 rounded-lg border p-4 transition-all"
              >
                <div className="flex items-center justify-between">
                  <p className="text-muted-foreground font-mono text-[11px] font-semibold tracking-wider uppercase">
                    Catalog Gini & Coverage
                  </p>
                  <span className="text-muted-foreground/60 font-mono text-[10px] uppercase opacity-0 transition-opacity group-hover:opacity-100">
                    Filter ↓
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <p className="text-foreground font-mono text-2xl font-bold">
                    {currentSummary?.giniCoefficient != null
                      ? currentSummary.giniCoefficient.toFixed(3)
                      : '--'}
                  </p>
                </div>
                <p className="text-muted-foreground font-mono text-[10px]">
                  Coverage:{' '}
                  {currentSummary?.catalogCoverage != null
                    ? `${(currentSummary.catalogCoverage * 100).toFixed(1)}%`
                    : '--'}
                </p>
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* Historical Runs & Regression Comparison Rail                       */}
          {/* ------------------------------------------------------------------ */}
          <div className="border-border/60 bg-card/60 space-y-3 rounded-lg border p-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Clock className="text-primary h-4 w-4" />
                <h3 className="text-muted-foreground font-mono text-xs font-semibold tracking-wider uppercase">
                  Historical Benchmark Runs ({runs.length})
                </h3>
              </div>

              {/* Regression Diff Selector */}
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground font-mono text-xs">
                  Compare with Baseline:
                </span>
                <select
                  value={compareBaselineId ?? ''}
                  onChange={(e) => setCompareBaselineId(e.target.value || null)}
                  className="border-border bg-background text-foreground focus:ring-primary rounded border px-2.5 py-1 font-mono text-xs focus:ring-1 focus:outline-none"
                >
                  <option value="">(None - View Single Run)</option>
                  {runs
                    .filter((r) => r.id !== selectedRunId)
                    .map((r) => (
                      <option key={r.id} value={r.id} suppressHydrationWarning>
                        {r.suiteName} ({formatBenchmarkDate(r.createdAt)})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Runs Horizontal Selector Pill Rail */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {runs.map((r) => {
                const isSelected = r.id === selectedRunId;
                return (
                  <button
                    key={r.id}
                    onClick={() => handleSelectRun(r.id)}
                    className={`flex flex-shrink-0 items-center gap-2 rounded border px-3 py-1.5 font-mono text-xs transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary font-bold'
                        : 'border-border/60 bg-background/50 hover:bg-muted text-muted-foreground'
                    }`}
                  >
                    <span className="font-semibold">{r.suiteName}</span>
                    <span className="text-muted-foreground text-[10px]" suppressHydrationWarning>
                      {formatBenchmarkTime(r.createdAt)}
                    </span>
                    <span className="bg-muted/60 rounded px-1 text-[10px]">
                      {r.passedTests}/{r.totalTests}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Side-by-Side Regression Diff Table (When Baseline Selected) */}
            {baselineRun && selectedRunDetails && !baselineComparable && (
              <p className="font-mono text-xs text-amber-500">
                Comparison unavailable: suite, provider, fixture hashes, or catalog snapshot differ
                or are missing.
              </p>
            )}
            {baselineRun && selectedRunDetails && baselineComparable && (
              <div className="border-border/80 bg-background/80 mt-3 overflow-x-auto rounded border p-3">
                <table className="w-full text-left font-mono text-xs">
                  <thead>
                    <tr className="border-border/60 text-muted-foreground border-b">
                      <th className="pb-2">Metric Dimension</th>
                      <th className="pb-2">Baseline ({baselineRun.suiteName})</th>
                      <th className="pb-2">Selected ({selectedRunDetails.suiteName})</th>
                      <th className="pb-2">Delta</th>
                      <th className="pb-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border/30 divide-y">
                    {/* NDCG Diff */}
                    <tr>
                      <td className="py-1.5 font-medium">MAUT agreement NDCG@3</td>
                      <td className="py-1.5">
                        {baselineRun.metricsSummary?.ndcg3?.mean?.toFixed(3) ?? '--'}
                      </td>
                      <td className="py-1.5">
                        {selectedRunDetails.metricsSummary?.ndcg3?.mean?.toFixed(3) ?? '--'}
                      </td>
                      <td className="py-1.5">
                        {(() => {
                          const b = baselineRun.metricsSummary?.ndcg3?.mean;
                          const c = selectedRunDetails.metricsSummary?.ndcg3?.mean;
                          if (b != null && c != null) {
                            const d = c - b;
                            return (
                              <span
                                className={
                                  d >= 0 ? 'font-bold text-emerald-500' : 'font-bold text-red-500'
                                }
                              >
                                {d >= 0 ? `+${d.toFixed(3)}` : d.toFixed(3)}
                              </span>
                            );
                          }
                          return '--';
                        })()}
                      </td>
                      <td className="py-1.5">
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-500">
                          Descriptive
                        </span>
                      </td>
                    </tr>

                    {/* CitePrec Diff */}
                    <tr>
                      <td className="py-1.5 font-medium">Lexical citation support proxy</td>
                      <td className="py-1.5">
                        {baselineRun.metricsSummary?.citePrec?.mean
                          ? `${(baselineRun.metricsSummary.citePrec.mean * 100).toFixed(1)}%`
                          : '--'}
                      </td>
                      <td className="py-1.5">
                        {selectedRunDetails.metricsSummary?.citePrec?.mean
                          ? `${(selectedRunDetails.metricsSummary.citePrec.mean * 100).toFixed(1)}%`
                          : '--'}
                      </td>
                      <td className="py-1.5">
                        {(() => {
                          const b = baselineRun.metricsSummary?.citePrec?.mean;
                          const c = selectedRunDetails.metricsSummary?.citePrec?.mean;
                          if (b != null && c != null) {
                            const d = (c - b) * 100;
                            return (
                              <span
                                className={
                                  d >= 0 ? 'font-bold text-emerald-500' : 'font-bold text-red-500'
                                }
                              >
                                {d >= 0 ? `+${d.toFixed(1)}%` : `${d.toFixed(1)}%`}
                              </span>
                            );
                          }
                          return '--';
                        })()}
                      </td>
                      <td className="py-1.5">
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-500">
                          Descriptive
                        </span>
                      </td>
                    </tr>

                    {/* Latency Diff */}
                    <tr>
                      <td className="py-1.5 font-medium">Tail Latency (p95)</td>
                      <td className="py-1.5">
                        {baselineRun.metricsSummary?.latencyP95
                          ? `${baselineRun.metricsSummary.latencyP95}ms`
                          : '--'}
                      </td>
                      <td className="py-1.5">
                        {selectedRunDetails.metricsSummary?.latencyP95
                          ? `${selectedRunDetails.metricsSummary.latencyP95}ms`
                          : '--'}
                      </td>
                      <td className="py-1.5">
                        {(() => {
                          const b = baselineRun.metricsSummary?.latencyP95;
                          const c = selectedRunDetails.metricsSummary?.latencyP95;
                          if (b != null && c != null) {
                            const d = c - b;
                            return (
                              <span
                                className={
                                  d <= 0 ? 'font-bold text-emerald-500' : 'font-bold text-red-500'
                                }
                              >
                                {d <= 0 ? `${d}ms` : `+${d}ms`}
                              </span>
                            );
                          }
                          return '--';
                        })()}
                      </td>
                      <td className="py-1.5">
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-500">
                          Component only
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ------------------------------------------------------------------ */}
          {/* Granular Test Cases Explorer                                       */}
          {/* ------------------------------------------------------------------ */}
          <div
            id="eval-test-cases-table"
            className="border-border/60 bg-card scroll-mt-20 space-y-4 rounded-lg border p-5"
          >
            <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
              <div className="flex items-center gap-2">
                <h3 className="text-foreground font-mono text-sm font-semibold tracking-wider uppercase">
                  Granular Test Execution Explorer ({filteredResults.length})
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Search Input */}
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-2.5 left-2.5 h-3.5 w-3.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by persona, query..."
                    className="border-border bg-background text-foreground focus:ring-primary w-56 rounded border py-1.5 pr-3 pl-8 font-mono text-xs focus:ring-1 focus:outline-none"
                  />
                </div>

                {/* Category Filter */}
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="border-border bg-background text-foreground focus:ring-primary rounded border px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:outline-none"
                >
                  <option value="all">All Categories</option>
                  <option value="recsys">Recommender</option>
                  <option value="multi-turn">Multi-Turn CRS</option>
                  <option value="rag">Attributed Q&A</option>
                  <option value="stress">Load Stress</option>
                </select>

                {/* Status Filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="border-border bg-background text-foreground focus:ring-primary rounded border px-2.5 py-1.5 font-mono text-xs focus:ring-1 focus:outline-none"
                >
                  <option value="all">All Statuses</option>
                  <option value="pass">Passed Only</option>
                  <option value="warn">Warnings</option>
                  <option value="fail">Failed Only</option>
                </select>
              </div>
            </div>

            {/* Table of Results */}
            <div className="border-border/40 overflow-x-auto rounded border">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Test Case ID</th>
                    <th className="px-3 py-2.5">Category</th>
                    <th className="px-3 py-2.5">Input Query / Persona</th>
                    <th className="px-3 py-2.5">Latency</th>
                    <th className="px-3 py-2.5">Key Scores</th>
                    <th className="px-3 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-border/20 divide-y">
                  {filteredResults.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-muted-foreground py-8 text-center">
                        No benchmark test results found matching current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredResults.map((r) => {
                      const isPass = r.status === 'pass';
                      const isWarn = r.status === 'warn';
                      return (
                        <tr
                          key={r.id || r.testCaseId}
                          className="hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-3 py-2.5">
                            {isPass ? (
                              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
                                <CheckCircle2 className="h-3 w-3" /> PASS
                              </span>
                            ) : isWarn ? (
                              <span className="inline-flex items-center gap-1 rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-500">
                                <AlertTriangle className="h-3 w-3" /> WARN
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-500">
                                <XCircle className="h-3 w-3" /> FAIL
                              </span>
                            )}
                          </td>
                          <td className="text-foreground px-3 py-2.5 font-semibold">
                            {r.testCaseId}
                          </td>
                          <td className="text-muted-foreground px-3 py-2.5 text-[10px] uppercase">
                            {r.category}
                          </td>
                          <td
                            className="text-foreground max-w-xs truncate px-3 py-2.5"
                            title={r.inputQuery}
                          >
                            {r.inputQuery}
                          </td>
                          <td className="text-muted-foreground px-3 py-2.5">{r.latencyMs} ms</td>
                          <td className="space-x-2 px-3 py-2.5">
                            {r.scores.jga != null && (
                              <span className="text-primary font-bold">
                                JGA: {(r.scores.jga * 100).toFixed(0)}%
                              </span>
                            )}
                            {r.scores.crr != null && (
                              <span className="font-bold text-emerald-500">
                                CRR: {(r.scores.crr * 100).toFixed(0)}%
                              </span>
                            )}
                            {r.scores.ndcg3 != null && (
                              <span className="text-primary font-bold">
                                MAUT agreement: {r.scores.ndcg3.toFixed(2)}
                              </span>
                            )}
                            {r.scores.citePrec != null && (
                              <span className="font-bold text-emerald-500">
                                Lexical citation proxy: {(r.scores.citePrec * 100).toFixed(0)}%
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <button
                              onClick={() => setInspectItem(r)}
                              className="border-border/80 bg-background hover:bg-muted inline-flex items-center gap-1 rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                            >
                              Trace <ChevronRight className="h-3 w-3" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tab 2: Run Provenance & Telemetry Diagnostics                      */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'diagnostics' && (
        <div className="space-y-6">
          {/* Preflight Report */}
          {preflightReport && (
            <section
              className="border-border/60 bg-card space-y-4 rounded-lg border p-5 font-mono text-xs"
              aria-label="Preflight report"
            >
              <div className="border-border/40 flex items-center justify-between border-b pb-3">
                <h3 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                  Fixture & Preflight Diagnostics
                </h3>
                <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-500">
                  Catalog Verified
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Catalog Phones
                  </span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {String(preflightReport.catalogCount)}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Missing Q&A Phones
                  </span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {Array.isArray(preflightReport.qaMissingPhones)
                      ? preflightReport.qaMissingPhones.length
                      : 0}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Missing Corpus
                  </span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {Array.isArray(preflightReport.qaMissingCorpus)
                      ? preflightReport.qaMissingCorpus.length
                      : 0}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Dataset Hashes
                  </span>
                  <p className="mt-1 text-lg font-bold text-emerald-500">Retained</p>
                </div>
              </div>
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                Fixture counts: {JSON.stringify(preflightReport.fixtureCounts)}
              </p>
            </section>
          )}

          {/* Run Provenance */}
          {selectedRunDetails ? (
            <section
              className="border-border/60 bg-card space-y-4 rounded-lg border p-5 font-mono text-xs"
              aria-label="Run provenance"
            >
              <div className="border-border/40 flex flex-col justify-between gap-2 border-b pb-3 sm:flex-row sm:items-center">
                <div>
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Run Provenance Record
                  </span>
                  <h3 className="text-foreground text-base font-bold">
                    {selectedRunDetails.suiteName} ·{' '}
                    <span className="uppercase">{selectedRunDetails.status}</span>
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-500">
                    {selectedRunDetails.passedTests} Passing
                  </span>
                  <span className="rounded border border-red-500/20 bg-red-500/10 px-2.5 py-1 text-xs font-bold text-red-500">
                    {selectedRunDetails.failedTests} Non-Passing
                  </span>
                </div>
              </div>

              {selectedRunDetails.metricsSummary?.executionError && (
                <div
                  role="alert"
                  className="rounded border border-red-500/40 bg-red-500/10 p-3 text-red-500"
                >
                  Execution failed: {selectedRunDetails.metricsSummary.executionError}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Trigger Source
                  </span>
                  <p className="text-foreground mt-1 font-semibold">
                    {selectedRunDetails.triggerSource}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Provider Track
                  </span>
                  <p className="text-foreground mt-1 font-semibold">
                    {String(selectedRunDetails.config?.providerTrack ?? 'unrecorded')}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Measurement Boundary
                  </span>
                  <p className="text-foreground mt-1 font-semibold">
                    {String(selectedRunDetails.config?.measurementBoundary ?? 'unrecorded')}
                  </p>
                </div>
              </div>

              {(selectedRunDetails.triggerSource === 'unverified-import' ||
                !selectedRunDetails.config?.preflight ||
                selectedRunDetails.config?.workingTreeDirty !== false) && (
                <p className="text-[11px] text-amber-500">
                  Imported, legacy, or uncommitted code provenance. These results are not suitable
                  for formal evaluation certification.
                </p>
              )}

              <details className="border-border/40 bg-muted/10 rounded border p-3">
                <summary className="text-muted-foreground hover:text-foreground cursor-pointer font-semibold">
                  Fixture, catalog, model and run metadata
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto text-[11px] whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      commitHash: selectedRunDetails.commitHash,
                      config: selectedRunDetails.config,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            </section>
          ) : (
            <div className="border-border/60 bg-card text-muted-foreground rounded-lg border p-6 text-center font-mono text-xs">
              Select a run from the history rail to inspect execution provenance.
            </div>
          )}

          {/* Generation Usage Coverage */}
          {selectedRunDetails?.metricsSummary?.generationProviderCalls != null && (
            <section
              className="border-border/60 bg-card space-y-3 rounded-lg border p-5 font-mono text-xs"
              aria-label="Generation usage coverage"
            >
              <h3 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                LLM Generation Usage & Quota Coverage
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">
                    Uncached Calls
                  </span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {selectedRunDetails.metricsSummary.generationProviderCalls}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Cache Hits</span>
                  <p className="mt-1 text-lg font-bold text-emerald-500">
                    {selectedRunDetails.metricsSummary.generationCacheHits ?? 0}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Tokens In</span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {selectedRunDetails.metricsSummary.tokenUsage?.tokensIn?.toLocaleString() ??
                      '--'}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Tokens Out</span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {selectedRunDetails.metricsSummary.tokenUsage?.tokensOut?.toLocaleString() ??
                      '--'}
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-[11px]">
                Usage reported for{' '}
                {selectedRunDetails.metricsSummary.generationUsageCoveredCalls ?? 0}/
                {selectedRunDetails.metricsSummary.generationProviderCalls} uncached calls.
                Embedding usage is outside this total.
              </p>
            </section>
          )}

          {/* Q&A Retrieval Signals */}
          {selectedRunDetails?.metricsSummary?.retrievalObservedCases != null && (
            <section
              className="border-border/60 bg-card space-y-3 rounded-lg border p-5 font-mono text-xs"
              aria-label="Q&A retrieval signal coverage"
            >
              <h3 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                Q&A Retrieval Signal Diagnostics
              </h3>
              <p className="text-foreground">
                FTS returned zero chunks for{' '}
                <span className="font-bold text-amber-500">
                  {selectedRunDetails.metricsSummary.ftsZeroCases ?? 'unrecorded'}
                </span>
                /{selectedRunDetails.metricsSummary.retrievalObservedCases} observed cases; vector
                returned zero for{' '}
                <span className="font-bold text-amber-500">
                  {selectedRunDetails.metricsSummary.vectorZeroCases ?? 'unrecorded'}
                </span>
                /{selectedRunDetails.metricsSummary.retrievalObservedCases}.
              </p>
              <p className="text-muted-foreground text-[11px]">
                A zero sparse branch indicates that case relied solely on dense vector retrieval.
                Review per-case evidence traces before assessing quality.
              </p>
            </section>
          )}

          {/* DB Retrieval Probe Diagnostics */}
          {selectedLoadTrace && (
            <section
              className="border-border/60 bg-card space-y-4 rounded-lg border p-5 font-mono text-xs"
              aria-label="Retrieval probe diagnostics"
            >
              <div className="border-border/40 flex items-center justify-between border-b pb-3">
                <h3 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                  DB Retrieval Probe Diagnostics
                </h3>
                <span className="text-muted-foreground text-[11px]">
                  {selectedLoadTrace.catalogCount} catalog phones ·{' '}
                  {selectedLoadTrace.targetChunkCount} phone chunks
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Goodput</span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {selectedRunDetails?.metricsSummary?.goodputQps ?? 'unrecorded'} req/s
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Attempt p95</span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {selectedRunDetails?.metricsSummary?.latencyP95 ?? 'unrecorded'} ms
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Loop Lag Max</span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {selectedLoadTrace.eventLoopLagMs != null
                      ? `${selectedLoadTrace.eventLoopLagMs} ms`
                      : 'n/a'}
                  </p>
                </div>
                <div className="border-border/40 bg-muted/20 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] uppercase">Errors</span>
                  <p className="text-foreground mt-1 text-lg font-bold">
                    {Object.keys(selectedLoadTrace.errorCounts).length
                      ? Object.keys(selectedLoadTrace.errorCounts).length
                      : '0'}
                  </p>
                </div>
              </div>
              {loadStages.length > 0 && (
                <div className="border-border/40 bg-muted/10 space-y-2 rounded border p-3">
                  <span className="text-muted-foreground text-[10px] font-semibold uppercase">
                    Stage Latency Breakdown (p95)
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {loadStages.map(([name, ms]) => (
                      <span
                        key={name}
                        className="border-border/60 bg-background rounded border px-2.5 py-1 text-[11px]"
                      >
                        <span className="text-muted-foreground">{name}:</span>{' '}
                        <span className="text-foreground font-bold">{ms}ms</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tab 3: Production Campaign Evidence & Gates                        */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'campaign' && (
        <div className="space-y-6">
          <section className="border-border/60 bg-card space-y-4 rounded-lg border p-5 font-mono text-xs">
            <div className="border-border/40 flex flex-col justify-between gap-2 border-b pb-3 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-foreground text-sm font-semibold tracking-wider uppercase">
                  Production Evaluation Campaign
                </h3>
                <p className="text-muted-foreground mt-1 text-[11px]">
                  Source-backed candidate pilot, blinded review, HTTP failure checks, and controlled
                  provider load.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={loadCampaign}
                  className="border-border bg-background hover:bg-muted rounded border px-3 py-1.5 text-[11px] uppercase transition-colors"
                >
                  Load Campaign Evidence
                </button>
                <button
                  type="button"
                  onClick={downloadReview}
                  className="border-border bg-background hover:bg-muted rounded border px-3 py-1.5 text-[11px] uppercase transition-colors"
                >
                  Download Blinded Review
                </button>
                <button
                  type="button"
                  onClick={() => reviewInputRef.current?.click()}
                  className="border-border bg-background hover:bg-muted rounded border px-3 py-1.5 text-[11px] uppercase transition-colors"
                >
                  Import Review Labels
                </button>
                <input
                  type="file"
                  accept=".json"
                  ref={reviewInputRef}
                  onChange={importReview}
                  className="hidden"
                />
              </div>
            </div>

            {campaignError && (
              <div
                role="alert"
                className="rounded border border-red-500/40 bg-red-500/10 p-3 text-red-500"
              >
                {campaignError}
              </div>
            )}

            {campaign ? (
              <div className="space-y-4">
                <CampaignEvidence summary={campaign} />
                <details className="border-border/40 bg-muted/10 rounded border p-3">
                  <summary className="text-muted-foreground hover:text-foreground cursor-pointer font-semibold">
                    Raw Campaign Evidence & Failure Examples
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto text-[11px] whitespace-pre-wrap">
                    {JSON.stringify(campaign, null, 2)}
                  </pre>
                </details>
              </div>
            ) : (
              <div className="border-border/40 bg-muted/10 text-muted-foreground rounded-lg border p-8 text-center">
                Click &ldquo;Load Campaign Evidence&rdquo; to fetch the latest evidence gate audits.
              </div>
            )}
          </section>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Slide-Over Trace Inspector Drawer                                  */}
      {/* ------------------------------------------------------------------ */}
      {inspectItem && (
        <div className="bg-background/80 fixed inset-0 z-50 flex justify-end backdrop-blur-sm">
          <div className="bg-card border-border h-full w-full max-w-2xl space-y-6 overflow-y-auto border-l p-6 shadow-2xl">
            <div className="border-border/60 flex items-center justify-between border-b pb-4">
              <div>
                <span className="text-primary font-mono text-xs font-bold uppercase">
                  {inspectItem.category} Audit Trace
                </span>
                <h3 className="text-foreground font-mono text-lg font-bold">
                  {inspectItem.testCaseId}
                </h3>
              </div>
              <button
                onClick={() => setInspectItem(null)}
                className="text-muted-foreground hover:text-foreground rounded p-1"
              >
                ✕
              </button>
            </div>

            {/* Input Query */}
            <div className="space-y-1 font-mono text-xs">
              <span className="text-muted-foreground font-semibold uppercase">
                User Query / Persona
              </span>
              <div className="bg-muted/30 text-foreground rounded p-3">
                {inspectItem.inputQuery}
              </div>
            </div>

            {/* Score Breakdown */}
            <div className="space-y-1 font-mono text-xs">
              <span className="text-muted-foreground font-semibold uppercase">
                Metric Breakdown
              </span>
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(inspectItem.scores).map(([k, v]) => (
                  <div
                    key={k}
                    className="border-border/60 bg-muted/20 rounded border p-2 text-center"
                  >
                    <span className="text-muted-foreground text-[10px] uppercase">{k}</span>
                    <p className="text-foreground font-bold">
                      {v != null ? Number(v).toFixed(3) : '--'}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Multi-Turn Trajectory Timeline */}
            {inspectItem.tracePayload?.multiTurnTrajectory && (
              <div className="space-y-4 font-mono text-xs">
                <div className="border-border/40 flex items-center justify-between border-b pb-2">
                  <span className="text-muted-foreground flex items-center gap-1.5 font-semibold uppercase">
                    <MessageSquare className="text-primary h-4 w-4" />
                    Multi-Turn Conversational Trajectory
                  </span>
                  <div className="flex items-center gap-2 text-[11px]">
                    <span className="bg-primary/10 text-primary rounded px-2 py-0.5 font-bold">
                      JGA: {(inspectItem.tracePayload.multiTurnTrajectory.jga * 100).toFixed(0)}%
                    </span>
                    <span className="rounded bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-500">
                      CRR:{' '}
                      {inspectItem.tracePayload.multiTurnTrajectory.crr != null
                        ? `${(inspectItem.tracePayload.multiTurnTrajectory.crr * 100).toFixed(0)}%`
                        : 'not evaluated'}
                    </span>
                    <span className="bg-muted text-muted-foreground rounded px-2 py-0.5">
                      {inspectItem.tracePayload.multiTurnTrajectory.tokensIn != null
                        ? `${inspectItem.tracePayload.multiTurnTrajectory.tokensIn} reported input tokens`
                        : 'Token usage unavailable'}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {inspectItem.tracePayload.multiTurnTrajectory.turns.map((t, idx) => (
                    <div
                      key={idx}
                      className="border-border/60 bg-muted/10 space-y-2.5 rounded-lg border p-3.5"
                    >
                      {/* Turn Header */}
                      <div className="flex items-center justify-between">
                        <span className="bg-primary/20 text-primary rounded px-2 py-0.5 text-[10px] font-bold">
                          TURN #{t.turnIndex}
                        </span>
                        <div className="flex items-center gap-2 text-[10px]">
                          <span
                            className={
                              t.kindMatched
                                ? 'font-semibold text-emerald-500'
                                : 'font-semibold text-amber-500'
                            }
                          >
                            {t.kind.toUpperCase()}
                          </span>
                          <span className="text-muted-foreground">{t.latencyMs} ms</span>
                          {t.hardConstraintSatisfied ? (
                            <span className="flex items-center gap-0.5 font-semibold text-emerald-500">
                              <CheckCircle2 className="h-3 w-3" /> CSR PASS
                            </span>
                          ) : (
                            <span className="flex items-center gap-0.5 font-semibold text-red-500">
                              <XCircle className="h-3 w-3" /> CSR FAIL
                            </span>
                          )}
                        </div>
                      </div>

                      {/* User Message */}
                      <div className="bg-background/80 border-border/40 text-foreground rounded border p-2.5 font-sans text-xs">
                        <span className="text-muted-foreground mb-0.5 block font-mono text-[10px]">
                          USER:
                        </span>
                        &quot;{t.userMessage}&quot;
                      </div>

                      {/* Diagnostic Badges */}
                      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span
                          className={`rounded border px-1.5 py-0.5 ${
                            t.jgaScore === 1
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                              : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                          }`}
                        >
                          JGA: {(t.jgaScore * 100).toFixed(0)}%
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 ${
                            t.retentionScore === 1
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                              : 'border-amber-500/20 bg-amber-500/10 text-amber-500'
                          }`}
                        >
                          Retention: {(t.retentionScore * 100).toFixed(0)}%
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 ${
                            t.mutationResponsiveness
                              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500'
                              : 'border-red-500/20 bg-red-500/10 text-red-500'
                          }`}
                        >
                          Mutation: {t.mutationResponsiveness ? '0-turn' : 'lag'}
                        </span>
                        {t.ndcg3 != null && (
                          <span className="bg-primary/10 text-primary border-primary/20 rounded border px-1.5 py-0.5">
                            NDCG@3: {t.ndcg3.toFixed(3)}
                          </span>
                        )}
                      </div>

                      {/* Violations if any */}
                      {t.constraintViolations.length > 0 && (
                        <div className="space-y-0.5 rounded border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-400">
                          {t.constraintViolations.map((v, vi) => (
                            <div key={vi} className="flex items-center gap-1">
                              <span>•</span>
                              <span>{v}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Picks for this turn */}
                      {t.picks.length > 0 && (
                        <div className="space-y-1">
                          <span className="text-muted-foreground text-[10px] font-semibold uppercase">
                            Recommended Picks ({t.picks.length})
                          </span>
                          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                            {t.picks.map((p, pi) => (
                              <div
                                key={pi}
                                className="border-border/40 bg-background/50 flex flex-col justify-between rounded border p-1.5 text-[11px]"
                              >
                                <span
                                  className="text-foreground truncate font-semibold"
                                  title={p.model}
                                >
                                  {p.brand} {p.model}
                                </span>
                                <div className="text-muted-foreground mt-1 flex items-center justify-between text-[10px]">
                                  <span>${p.msrpUsd ?? 'N/A'}</span>
                                  <span className="text-primary font-bold">
                                    score: {p.score.toFixed(1)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommender Picks Audit */}
            {inspectItem.tracePayload?.actualPicks && (
              <div className="space-y-1 font-mono text-xs">
                <span className="text-muted-foreground font-semibold uppercase">
                  Recommended Picks (Top 3)
                </span>
                <div className="space-y-2">
                  {inspectItem.tracePayload.actualPicks.map((p, idx) => (
                    <div
                      key={idx}
                      className="border-border/40 bg-muted/20 flex items-center justify-between rounded border p-2.5"
                    >
                      <span className="text-foreground font-bold">{p.slug}</span>
                      <div className="space-x-3 text-right">
                        <span className="text-muted-foreground">${p.priceUsd ?? 'N/A'}</span>
                        <span className="bg-primary/10 text-primary rounded px-1.5 py-0.5 font-bold">
                          Utility Grade: {p.utilityGrade}/3
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* RAG Answer & Retrieved Chunks */}
            {inspectItem.tracePayload?.generatedText && (
              <div className="space-y-1 font-mono text-xs">
                <span className="text-muted-foreground font-semibold uppercase">
                  Generated Answer with Citations
                </span>
                <div className="bg-muted/30 text-foreground rounded p-3 leading-relaxed whitespace-pre-wrap">
                  {inspectItem.tracePayload.generatedText}
                </div>
              </div>
            )}

            {/* Retrieved Chunks */}
            {inspectItem.tracePayload?.retrievedChunks && (
              <div className="space-y-2 font-mono text-xs">
                <span className="text-muted-foreground font-semibold uppercase">
                  Retrieved Chunks Context ({inspectItem.tracePayload.retrievedChunks.length})
                </span>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {inspectItem.tracePayload.retrievedChunks.map((c, i) => (
                    <div
                      key={i}
                      className="border-border/40 bg-muted/20 space-y-1 rounded border p-2"
                    >
                      <div className="text-muted-foreground flex items-center justify-between text-[10px]">
                        <span className="text-primary font-semibold">{c.sourceTitle}</span>
                        <span>Chunk ID: {c.chunkId.slice(0, 8)}...</span>
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-snug">
                        {c.textSnippet}...
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error or Violations */}
            {inspectItem.errorDetails && (
              <div className="rounded border border-red-500/40 bg-red-500/10 p-3 font-mono text-xs text-red-500">
                <p className="flex items-center gap-1.5 font-bold">
                  <ShieldAlert className="h-4 w-4" /> Execution Error
                </p>
                <p className="mt-1">{inspectItem.errorDetails}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

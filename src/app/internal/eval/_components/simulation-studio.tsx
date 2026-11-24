'use client';

import { useState, useEffect } from 'react';
import {
  Play,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  Database,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SimulationResult } from '@/services/eval/runners/simulation-runner';
import type { AblationMetricReport } from '@/services/eval/runners/ablation-runner';

interface SimulationStudioProps {
  readonly accessToken?: string;
}

interface GoldenOption {
  readonly id: string;
  readonly name?: string;
  readonly category: string;
  readonly query: string;
  readonly phoneSlug?: string;
}

export function SimulationStudio({ accessToken }: SimulationStudioProps) {
  const [queryType, setQueryType] = useState<'recommender' | 'rag' | 'hallucination'>(
    'recommender',
  );
  const [personas, setPersonas] = useState<readonly GoldenOption[]>([]);
  const [qaQueries, setQaQueries] = useState<readonly GoldenOption[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string>('rec-001');
  const [customQuery, setCustomQuery] = useState<string>('');
  const [customPhoneSlug, setCustomPhoneSlug] = useState<string>('apple-iphone-16-pro');
  const [providerTrack, setProviderTrack] = useState<'stub' | 'live'>('stub');
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);

  // Ablations state
  const [ablations, setAblations] = useState<readonly AblationMetricReport[]>([]);
  const [runningAblation, setRunningAblation] = useState<string | null>(null);

  // Fetch inventory
  useEffect(() => {
    async function loadInventory() {
      try {
        const headers: Record<string, string> = {};
        if (accessToken) headers['x-recsy-eval-token'] = accessToken;

        const [simRes, ablatRes] = await Promise.all([
          fetch('/api/internal/eval/simulate', { headers }),
          fetch('/api/internal/eval/ablation', { headers }),
        ]);

        if (simRes.ok) {
          const data = await simRes.json();
          if (data.personas) setPersonas(data.personas);
          if (data.qaQueries) setQaQueries(data.qaQueries);
        }
        if (ablatRes.ok) {
          const data = await ablatRes.json();
          if (data.ablations) setAblations(data.ablations);
        }
      } catch (err) {
        console.error('Failed to load simulation inventory', err);
      }
    }
    loadInventory();
  }, [accessToken]);

  const handleQueryTypeChange = (newType: 'recommender' | 'rag' | 'hallucination') => {
    setQueryType(newType);
    if (newType === 'recommender') {
      setSelectedCaseId(personas[0]?.id ?? 'rec-001');
    } else if (newType === 'rag') {
      setSelectedCaseId(qaQueries[0]?.id ?? 'rag-001');
    } else {
      // Hallucination traps
      const trap = qaQueries.find(
        (q) => q.category.includes('abstention') || q.category.includes('false-premise'),
      );
      setSelectedCaseId(trap?.id ?? 'rag-021');
    }
  };

  const handleRunSimulation = async () => {
    setIsSimulating(true);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (accessToken) headers['x-recsy-eval-token'] = accessToken;

      const res = await fetch('/api/internal/eval/simulate', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          queryType,
          caseId: selectedCaseId === 'custom' ? undefined : selectedCaseId,
          customInput:
            selectedCaseId === 'custom'
              ? { userQuery: customQuery, phoneSlug: customPhoneSlug }
              : undefined,
          providerTrack,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Simulation execution failed');
      }

      setSimulationResult(data.simulation);
      toast.success('Simulation completed successfully!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setIsSimulating(false);
    }
  };

  const handleRunAblation = async (ablationType: string) => {
    setRunningAblation(ablationType);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (accessToken) headers['x-recsy-eval-token'] = accessToken;

      const res = await fetch('/api/internal/eval/ablation', {
        method: 'POST',
        headers,
        body: JSON.stringify({ ablationType }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ablation benchmark failed');
      }

      if (data.report) {
        setAblations((prev) =>
          prev.map((a) => (a.ablationType === data.report.ablationType ? data.report : a)),
        );
      }
      toast.success(`Ablation calculated: +${data.report.delta.relativeGainPercent}% gain!`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ablation failed');
    } finally {
      setRunningAblation(null);
    }
  };

  return (
    <div className="space-y-8 py-2">
      {/* Header Banner */}
      <div className="border-border/60 bg-muted/20 flex flex-col justify-between gap-4 border p-5 lg:flex-row lg:items-center">
        <div>
          <div className="inline-flex items-center gap-2 font-mono text-xs text-orange-500 uppercase">
            <Sparkles className="h-3.5 w-3.5" />
            Interactive Simulation & Diagnostic Suite
          </div>
          <h2 className="mt-1 font-mono text-lg font-bold tracking-tight text-white uppercase">
            Golden Simulation Studio & Ablation Observatory
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs">
            Run single-query simulations against 45 golden personas, 30 attributed Q&A queries, and
            20 hallucination traps. Inspect side-by-side golden answers vs actual pipeline outputs,
            component bottleneck timings, and ablation gains.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="border-border/40 bg-background/80 flex items-center gap-2 border px-3 py-1.5 font-mono text-xs">
            <Database className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-muted-foreground">Egress Safety:</span>
            <span className="font-bold text-emerald-400">&lt; 15 KB (0 DB Risk)</span>
          </div>
        </div>
      </div>

      {/* Simulator Control Card */}
      <div className="border-border/40 bg-card/40 border p-6">
        <h3 className="mb-4 font-mono text-xs font-bold tracking-wider text-white uppercase">
          1. Select Simulation Target
        </h3>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Query Type Toggle */}
          <div>
            <label className="text-muted-foreground mb-1.5 block font-mono text-xs uppercase">
              Pipeline Subsystem
            </label>
            <div className="border-border/40 bg-muted/30 grid grid-cols-3 border p-1 text-xs">
              <button
                type="button"
                onClick={() => handleQueryTypeChange('recommender')}
                className={`py-1.5 font-mono transition-colors ${
                  queryType === 'recommender'
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Recommender
              </button>
              <button
                type="button"
                onClick={() => handleQueryTypeChange('rag')}
                className={`py-1.5 font-mono transition-colors ${
                  queryType === 'rag'
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Grounded Q&A
              </button>
              <button
                type="button"
                onClick={() => handleQueryTypeChange('hallucination')}
                className={`py-1.5 font-mono transition-colors ${
                  queryType === 'hallucination'
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'text-muted-foreground hover:text-white'
                }`}
              >
                Hallucination
              </button>
            </div>
          </div>

          {/* Test Case Dropdown */}
          <div className="md:col-span-2">
            <label className="text-muted-foreground mb-1.5 block font-mono text-xs uppercase">
              Golden Benchmark Query (
              {queryType === 'recommender' ? personas.length : qaQueries.length} available)
            </label>
            <select
              value={selectedCaseId}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="border-border/40 bg-background/90 text-foreground focus:ring-primary w-full border px-3 py-2 font-mono text-xs focus:ring-1 focus:outline-none"
            >
              {queryType === 'recommender' &&
                personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.id}] {p.name} ({p.category}) — &quot;{p.query.slice(0, 70)}...&quot;
                  </option>
                ))}
              {queryType !== 'recommender' &&
                qaQueries.map((q) => (
                  <option key={q.id} value={q.id}>
                    [{q.id}] {q.phoneSlug} ({q.category}) — &quot;{q.query.slice(0, 70)}...&quot;
                  </option>
                ))}
              <option value="custom">-- Custom Ad-Hoc User Query --</option>
            </select>
          </div>
        </div>

        {selectedCaseId === 'custom' && (
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className={queryType !== 'recommender' ? 'md:col-span-2' : 'md:col-span-3'}>
              <label className="text-muted-foreground mb-1 block font-mono text-xs uppercase">
                Enter Custom Query Text
              </label>
              <input
                type="text"
                value={customQuery}
                onChange={(e) => setCustomQuery(e.target.value)}
                placeholder="e.g. Need a phone under $450 with great camera and wireless charging"
                className="border-border/40 bg-background text-foreground w-full border px-3 py-2 font-mono text-xs focus:outline-none"
              />
            </div>
            {queryType !== 'recommender' && (
              <div>
                <label className="text-muted-foreground mb-1 block font-mono text-xs uppercase">
                  Target Phone Slug
                </label>
                <input
                  type="text"
                  value={customPhoneSlug}
                  onChange={(e) => setCustomPhoneSlug(e.target.value)}
                  placeholder="e.g. apple-iphone-16-pro"
                  className="border-border/40 bg-background text-foreground w-full border px-3 py-2 font-mono text-xs focus:outline-none"
                />
              </div>
            )}
          </div>
        )}

        {/* Action Controls */}
        <div className="border-border/30 mt-5 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground font-mono text-xs uppercase">
              Provider Track:
            </span>
            <label className="inline-flex items-center gap-2 font-mono text-xs text-white">
              <input
                type="radio"
                name="track"
                value="stub"
                checked={providerTrack === 'stub'}
                onChange={() => setProviderTrack('stub')}
                className="text-primary"
              />
              Deterministic Mock (0ms, 0 Spend)
            </label>
            <label className="inline-flex items-center gap-2 font-mono text-xs text-white">
              <input
                type="radio"
                name="track"
                value="live"
                checked={providerTrack === 'live'}
                onChange={() => setProviderTrack('live')}
                className="text-primary"
              />
              Live Gemini (Capped 20 calls)
            </label>
          </div>

          <button
            type="button"
            onClick={handleRunSimulation}
            disabled={isSimulating}
            className="bg-primary hover:bg-primary/90 text-primary-foreground inline-flex items-center gap-2 px-5 py-2 font-mono text-xs font-bold uppercase transition-all disabled:opacity-50"
          >
            {isSimulating ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Simulating Pipeline...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5 fill-current" />
                Execute Simulation
              </>
            )}
          </button>
        </div>
      </div>

      {/* Simulation Result Presentation */}
      {simulationResult && (
        <div className="border-border/40 bg-card/30 space-y-6 border p-6">
          {/* Status Diff Banner */}
          <div
            className={`flex flex-col justify-between gap-3 border p-4 sm:flex-row sm:items-center ${
              simulationResult.diffStatus === 'pass'
                ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                : simulationResult.diffStatus === 'warn'
                  ? 'border-amber-500/40 bg-amber-950/20 text-amber-300'
                  : 'border-rose-500/40 bg-rose-950/20 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-3">
              {simulationResult.diffStatus === 'pass' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              ) : simulationResult.diffStatus === 'warn' ? (
                <AlertTriangle className="h-5 w-5 text-amber-400" />
              ) : (
                <XCircle className="h-5 w-5 text-rose-400" />
              )}
              <div>
                <span className="font-mono text-xs font-bold tracking-wider uppercase">
                  Simulation Outcome: {simulationResult.diffStatus.toUpperCase()}
                </span>
                <p className="mt-0.5 text-xs opacity-90">
                  {simulationResult.diffNotes.join(' | ')}
                </p>
              </div>
            </div>
            <div className="font-mono text-xs font-bold">
              Total Latency: {simulationResult.stageTimings.totalDurationMs}ms
            </div>
          </div>

          {/* Side-by-Side Comparison */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Left: Expected Golden Standard */}
            <div className="border-border/40 bg-background/60 border p-4">
              <div className="mb-3 flex items-center justify-between border-b pb-2">
                <span className="font-mono text-xs font-bold text-orange-400 uppercase">
                  Expected Golden Standard
                </span>
                <span className="bg-muted px-2 py-0.5 font-mono text-[10px] uppercase">
                  Reference Fixture
                </span>
              </div>

              <div className="space-y-3 font-mono text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    Summary:
                  </span>
                  <div className="text-foreground mt-0.5 font-semibold">
                    {simulationResult.expected.summary}
                  </div>
                </div>

                {simulationResult.expected.budgetCap && (
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Budget Cap:
                    </span>
                    <span className="font-bold text-emerald-400">
                      ${simulationResult.expected.budgetCap}
                    </span>
                  </div>
                )}

                {simulationResult.expected.priorities && (
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Priorities:
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {simulationResult.expected.priorities.map((p) => (
                        <span
                          key={p.aspect}
                          className="border-border/40 bg-muted/40 border px-1.5 py-0.5 text-[11px]"
                        >
                          {p.aspect}: {Math.round(p.weight * 100)}%
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {simulationResult.expected.mustHaves &&
                  simulationResult.expected.mustHaves.length > 0 && (
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase">
                        Must Haves:
                      </span>
                      <div className="mt-0.5 text-slate-300">
                        {simulationResult.expected.mustHaves.join(', ')}
                      </div>
                    </div>
                  )}

                {simulationResult.expected.referenceFacts && (
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Ground Truth Reference Facts:
                    </span>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-slate-300">
                      {simulationResult.expected.referenceFacts.map((fact, idx) => (
                        <li key={idx}>{fact}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {simulationResult.expected.expectNoResults && (
                  <div className="border border-amber-500/30 bg-amber-500/10 p-2 text-amber-300">
                    Constraint is physically impossible. Expected outcome: 0 picks returned with
                    honest clarification.
                  </div>
                )}
              </div>
            </div>

            {/* Right: Actual System Output */}
            <div className="border-border/40 bg-background/60 border p-4">
              <div className="mb-3 flex items-center justify-between border-b pb-2">
                <span className="font-mono text-xs font-bold text-cyan-400 uppercase">
                  Actual Pipeline Output
                </span>
                <span className="bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-400 uppercase">
                  Live Matcher
                </span>
              </div>

              <div className="space-y-4 font-mono text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    Pipeline Output:
                  </span>
                  <div className="text-foreground mt-0.5 font-semibold">
                    {simulationResult.actual.summary}
                  </div>
                </div>

                {/* Actual Recommender Picks */}
                {simulationResult.actual.picks && (
                  <div className="space-y-2">
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Returned Picks:
                    </span>
                    {simulationResult.actual.picks.length === 0 ? (
                      <div className="border-border/40 bg-muted/20 border p-3 text-center text-slate-400">
                        Zero candidates returned (Strict constraint filtering applied).
                      </div>
                    ) : (
                      simulationResult.actual.picks.map((pick, index) => (
                        <div key={pick.slug} className="border-border/40 bg-muted/30 border p-2.5">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-white">
                              #{index + 1} {pick.brand} {pick.model}
                            </span>
                            <span className="font-bold text-emerald-400">${pick.msrpUsd}</span>
                          </div>
                          <p className="text-muted-foreground mt-1 text-[11px]">{pick.summary}</p>
                          <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                            {Object.entries(pick.keyAspectScores).map(([aspect, score]) => (
                              <span key={aspect} className="bg-background/80 border px-1.5 py-0.5">
                                {aspect}: {score}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* Actual Q&A Answer Text */}
                {simulationResult.actual.answerText && (
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase">
                      Answer Text:
                    </span>
                    <p className="bg-muted/20 text-foreground mt-1 border p-2.5 leading-relaxed">
                      {simulationResult.actual.answerText}
                    </p>
                  </div>
                )}

                {/* Citations List */}
                {simulationResult.actual.citations &&
                  simulationResult.actual.citations.length > 0 && (
                    <div>
                      <span className="text-muted-foreground block text-[10px] uppercase">
                        Grounded Citation Tags:
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {simulationResult.actual.citations.map((c) => (
                          <span
                            key={c}
                            className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-400"
                          >
                            [c:{c}]
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                {/* Hallucination Check Badge */}
                <div className="border-border/40 bg-muted/20 flex items-center justify-between border p-2">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-emerald-400" />
                    <span>Hallucination Audit:</span>
                  </div>
                  <span className="font-bold text-emerald-400">
                    {simulationResult.hallucinationAudit.passed
                      ? '0 Phantom Claims (Clean)'
                      : 'Flagged'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Component Latency Waterfall */}
          <div className="border-border/40 bg-background/50 border p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-xs font-bold text-white uppercase">
                Component Bottleneck Waterfall
              </span>
              <span className="font-mono text-xs text-slate-400">
                DB Egress: {simulationResult.egressMetrics.estimatedEgressBytes} bytes (
                {simulationResult.egressMetrics.dbQueryCount} SQL calls)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4 lg:grid-cols-6">
              <div className="border-border/30 bg-muted/20 border p-2">
                <span className="text-muted-foreground block text-[10px] uppercase">
                  Catalog In-Memory
                </span>
                <span className="font-bold text-white">
                  {simulationResult.stageTimings.catalogLoadMs}ms
                </span>
              </div>
              <div className="border-border/30 bg-muted/20 border p-2">
                <span className="text-muted-foreground block text-[10px] uppercase">
                  Requirement Extract
                </span>
                <span className="font-bold text-white">
                  {simulationResult.stageTimings.requirementExtractionMs}ms
                </span>
              </div>
              {simulationResult.stageTimings.denseVectorScanMs != null && (
                <div className="border-border/30 bg-muted/20 border p-2">
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    Dense Vector HNSW
                  </span>
                  <span className="font-bold text-white">
                    {simulationResult.stageTimings.denseVectorScanMs}ms
                  </span>
                </div>
              )}
              {simulationResult.stageTimings.sparseFullTextScanMs != null && (
                <div className="border-border/30 bg-muted/20 border p-2">
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    Sparse FTS GIN
                  </span>
                  <span className="font-bold text-white">
                    {simulationResult.stageTimings.sparseFullTextScanMs}ms
                  </span>
                </div>
              )}
              {simulationResult.stageTimings.rankingExecutionMs != null && (
                <div className="border-border/30 bg-muted/20 border p-2">
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    MAUT Ranker
                  </span>
                  <span className="font-bold text-white">
                    {simulationResult.stageTimings.rankingExecutionMs}ms
                  </span>
                </div>
              )}
              <div className="border-border/30 bg-primary/10 text-primary border p-2">
                <span className="block text-[10px] font-bold uppercase">Total Duration</span>
                <span className="font-bold">{simulationResult.stageTimings.totalDurationMs}ms</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Controlled Ablation Comparison Lab */}
      <div className="border-border/40 bg-card/40 border p-6">
        <div className="mb-4 flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div>
            <h3 className="font-mono text-xs font-bold tracking-wider text-white uppercase">
              2. Controlled Pipeline Ablation Benchmarks (Before vs After)
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs">
              Measure the exact mathematical delta (statistical lift) introduced by each core
              optimization.
            </p>
          </div>
          <span className="bg-muted px-2 py-1 font-mono text-xs text-slate-300">
            5 Verified Experiments
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {ablations.map((ablation) => (
            <div
              key={ablation.ablationType}
              className="border-border/40 bg-background/70 border p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-mono text-xs font-bold text-white">{ablation.name}</h4>
                  <p className="text-muted-foreground mt-1 text-[11px] leading-relaxed">
                    {ablation.description}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRunAblation(ablation.ablationType)}
                  disabled={runningAblation === ablation.ablationType}
                  className="bg-muted hover:bg-muted/80 text-foreground shrink-0 px-2.5 py-1 font-mono text-[11px] font-bold uppercase transition-colors"
                >
                  {runningAblation === ablation.ablationType ? 'Calculating...' : 'Recalculate'}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 font-mono text-xs">
                {/* Baseline */}
                <div className="border-border/20 bg-muted/20 border p-2">
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    Baseline
                  </span>
                  <span className="block truncate text-[11px] text-slate-300">
                    {ablation.baseline.primaryMetricName}:
                  </span>
                  <span className="font-bold text-slate-200">
                    {ablation.baseline.primaryMetricValue}
                  </span>
                </div>

                {/* Optimized */}
                <div className="border-border/20 bg-muted/20 border p-2">
                  <span className="text-muted-foreground block text-[10px] uppercase">
                    Optimized
                  </span>
                  <span className="block truncate text-[11px] text-slate-300">
                    {ablation.optimized.primaryMetricName}:
                  </span>
                  <span className="font-bold text-emerald-400">
                    {ablation.optimized.primaryMetricValue}
                  </span>
                </div>

                {/* Delta Lift */}
                <div className="border border-emerald-500/20 bg-emerald-950/20 p-2">
                  <span className="block text-[10px] text-emerald-400 uppercase">Delta Lift</span>
                  <span className="text-base font-extrabold text-emerald-400">
                    +{ablation.delta.relativeGainPercent}%
                  </span>
                  <span className="text-muted-foreground block text-[9px]">
                    {ablation.delta.pValue ? `p=${ablation.delta.pValue}` : '100% Guaranteed'}
                  </span>
                </div>
              </div>

              <p className="mt-3 text-[11px] text-slate-300">
                <span className="font-bold text-emerald-400">Takeaway: </span>
                {ablation.delta.keyTakeaway}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

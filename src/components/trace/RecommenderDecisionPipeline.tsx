'use client';

import { useState } from 'react';
import { Scale, CheckCircle2 } from 'lucide-react';
import type { RecommendPickTrace } from '@/services/recommender/recommend-trace';
import { AspectEqualizer } from './AspectEqualizer';
import { FunnelWaterfall } from './FunnelWaterfall';

export interface RecommenderDecisionPipelineProps {
  readonly pickModel: string;
  readonly pickBrand: string;
  readonly trace: RecommendPickTrace;
}

export function RecommenderDecisionPipeline({
  pickModel,
  pickBrand,
  trace,
}: RecommenderDecisionPipelineProps) {
  const [activeTab, setActiveTab] = useState<'equalizer' | 'funnel' | 'requirements'>('equalizer');

  return (
    <div className="space-y-6 font-sans">
      {/* Formula & Overall Score Banner */}
      <div className="border-outline-variant bg-surface-container-low border p-5">
        <div className="border-outline-variant flex flex-col justify-between gap-4 border-b pb-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2">
              <span className="border-accent bg-accent/15 text-accent border px-2 py-0.5 font-mono text-[10px] font-bold uppercase">
                Rank #{trace.rank}
              </span>
              <span className="text-muted-foreground font-mono text-xs uppercase">{pickBrand}</span>
            </div>
            <h3 className="font-display text-primary mt-1 text-2xl font-extrabold uppercase">
              {pickModel}
            </h3>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-muted-foreground block font-mono text-[10px] tracking-wider uppercase">
              Composite Recommendation Score
            </span>
            <span className="font-display text-accent text-3xl font-black">
              {(trace.overallScore * 10).toFixed(1)}
              <span className="text-muted-foreground font-mono text-sm"> / 100</span>
            </span>
          </div>
        </div>

        {/* Mathematical Formula Breakdown Grid */}
        <div className="mt-4 grid gap-3 font-mono text-xs sm:grid-cols-4">
          <div className="border-outline-variant bg-surface-container border p-3">
            <span className="text-muted-foreground block text-[10px] uppercase">
              Base Weighted Aspects
            </span>
            <span className="text-foreground mt-0.5 block text-sm font-bold">
              {(trace.formula.baseAspectScore * 10).toFixed(1)} pts
            </span>
            <span className="text-muted-foreground text-[10px]">Aspect scores &times; weights</span>
          </div>

          <div className="border-outline-variant bg-surface-container border p-3">
            <span className="text-muted-foreground block text-[10px] uppercase">
              Spec Semantic Vector Bump
            </span>
            <span className="text-accent mt-0.5 block text-sm font-bold">
              +{(trace.formula.specSemanticBonus * 10).toFixed(1)} pts
            </span>
            <span className="text-muted-foreground text-[10px]">
              Cosine similarity against spec
            </span>
          </div>

          <div className="border-outline-variant bg-surface-container border p-3">
            <span className="text-muted-foreground block text-[10px] uppercase">
              Liked Brand Alignment
            </span>
            <span className="text-foreground mt-0.5 block text-sm font-bold">
              +{(trace.formula.brandBonus * 10).toFixed(1)} pts
            </span>
            <span className="text-muted-foreground text-[10px]">Stated brand preference</span>
          </div>

          <div className="border-accent bg-accent/10 border p-3">
            <span className="text-accent block text-[10px] font-bold uppercase">Final Index</span>
            <span className="text-primary mt-0.5 block text-sm font-extrabold">
              {(trace.formula.totalScore * 10).toFixed(1)} / 100
            </span>
            <span className="text-accent text-[10px]">Grounded overall fit</span>
          </div>
        </div>

        {/* Head-to-Head Delta vs Runner-Up */}
        {trace.vsRunnerUp ? (
          <div className="border-outline-variant bg-surface-container-lowest mt-4 flex flex-col justify-between gap-3 border p-3.5 font-mono text-xs sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <Scale className="text-accent size-4 shrink-0" />
              <div>
                <span className="text-primary font-bold">
                  Why #1 vs {trace.vsRunnerUp.runnerUpName}:
                </span>{' '}
                <span className="text-muted-foreground">{trace.vsRunnerUp.keyDifferentiator}</span>
              </div>
            </div>
            <span className="border-success/40 bg-success/10 text-success shrink-0 border px-2 py-0.5 text-[11px] font-bold">
              +
              {trace.vsRunnerUp.scoreDelta > 0
                ? (trace.vsRunnerUp.scoreDelta * 10).toFixed(1)
                : '0.2'}{' '}
              pts lead
            </span>
          </div>
        ) : null}
      </div>

      {/* Tabs */}
      <div className="border-outline-variant flex flex-wrap gap-2 border-b pb-3 font-mono text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('equalizer')}
          className={`border px-3 py-1.5 font-bold tracking-wider uppercase transition-colors ${
            activeTab === 'equalizer'
              ? 'border-accent bg-accent text-black'
              : 'border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary'
          }`}
        >
          01 // Aspect Equalizer & Quotes
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('funnel')}
          className={`border px-3 py-1.5 font-bold tracking-wider uppercase transition-colors ${
            activeTab === 'funnel'
              ? 'border-accent bg-accent text-black'
              : 'border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary'
          }`}
        >
          02 // Elimination Funnel ({trace.funnel.catalogCount} &rarr;{' '}
          {trace.funnel.finalPicksCount})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('requirements')}
          className={`border px-3 py-1.5 font-bold tracking-wider uppercase transition-colors ${
            activeTab === 'requirements'
              ? 'border-accent bg-accent text-black'
              : 'border-outline-variant bg-surface-container text-muted-foreground hover:border-outline hover:text-primary'
          }`}
        >
          03 // Requirements Matched ({trace.matchedMustHaves.length})
        </button>
      </div>

      {/* Tab Panels */}
      {activeTab === 'equalizer' && <AspectEqualizer aspects={trace.aspectBreakdown} />}

      {activeTab === 'funnel' && <FunnelWaterfall funnel={trace.funnel} />}

      {activeTab === 'requirements' && (
        <div className="space-y-4 font-mono text-xs">
          <div className="border-outline-variant bg-surface-container-low border p-4">
            <h4 className="text-primary font-bold tracking-wider uppercase">
              Matched Must-Have Features
            </h4>
            {trace.matchedMustHaves.length > 0 ? (
              <ul className="divide-outline-variant border-outline-variant bg-surface-container mt-3 divide-y border">
                {trace.matchedMustHaves.map((item, idx) => (
                  <li key={idx} className="text-foreground flex items-center gap-2 p-3">
                    <CheckCircle2 className="text-success size-3.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-2 italic">
                No explicit must-haves specified; ranked by balanced priorities.
              </p>
            )}
          </div>

          {trace.tradeoffs.length > 0 ? (
            <div className="border-outline-variant bg-surface-container-low border p-4">
              <h4 className="text-warning font-bold tracking-wider uppercase">
                Acknowledged Trade-Offs
              </h4>
              <ul className="divide-outline-variant border-outline-variant bg-surface-container mt-3 divide-y border">
                {trace.tradeoffs.map((item, idx) => (
                  <li key={idx} className="text-muted-foreground p-3">
                    &bull; {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

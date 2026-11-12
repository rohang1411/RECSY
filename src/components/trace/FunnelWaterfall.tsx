'use client';

import { motion } from 'motion/react';
import { Filter } from 'lucide-react';

export interface FunnelWaterfallProps {
  readonly funnel: {
    readonly catalogCount: number;
    readonly budgetEligibleCount: number;
    readonly specEligibleCount: number;
    readonly finalPicksCount: number;
  };
}

export function FunnelWaterfall({ funnel }: FunnelWaterfallProps) {
  const max = Math.max(funnel.catalogCount, 1);

  const steps = [
    {
      id: 'catalog',
      label: '01 // Active Smartphone Catalog',
      count: funnel.catalogCount,
      detail: 'Complete active catalog with verified specs and regional pricing.',
      color: 'bg-primary',
    },
    {
      id: 'budget',
      label: '02 // Budget Ceiling & Availability Filter',
      count: funnel.budgetEligibleCount,
      eliminated: Math.max(0, funnel.catalogCount - funnel.budgetEligibleCount),
      detail: 'Phones meeting stated price ceiling without breaking budget constraint.',
      color: 'bg-accent',
    },
    {
      id: 'specs',
      label: '03 // Hard Feature & Recency Gates',
      count: funnel.specEligibleCount,
      eliminated: Math.max(0, funnel.budgetEligibleCount - funnel.specEligibleCount),
      detail: 'Hardware requirements (zoom, form factor, release recency ≤ 3.5 yrs).',
      color: 'bg-accent/80',
    },
    {
      id: 'final',
      label: '04 // Diverse Ranked Recommendations',
      count: funnel.finalPicksCount,
      detail: 'Highest composite score shortlist (max 1 per brand lineage).',
      color: 'bg-success',
    },
  ];

  return (
    <div className="space-y-4 font-sans">
      <div className="border-outline-variant bg-surface-container-low border p-4">
        <h4 className="text-primary flex items-center gap-2 font-mono text-xs font-bold tracking-[0.16em] uppercase">
          <Filter className="text-accent size-3.5" />
          Catalog Elimination Funnel (Waterfall Audit)
        </h4>
        <p className="text-muted-foreground mt-1 font-mono text-xs">
          Exact step-by-step candidate elimination from the entire market down to this
          recommendation.
        </p>
      </div>

      <div className="space-y-2">
        {steps.map((s, idx) => {
          const widthPct = Math.max(8, (s.count / max) * 100);

          return (
            <div
              key={s.id}
              className="border-outline-variant bg-surface-container-low border p-4 text-left"
            >
              <div className="flex flex-col justify-between gap-2 font-mono text-xs sm:flex-row sm:items-center">
                <span className="text-primary font-bold">{s.label}</span>
                <div className="flex items-center gap-2">
                  <span className="text-foreground text-sm font-extrabold">
                    {s.count} candidates
                  </span>
                  {s.eliminated ? (
                    <span className="text-destructive font-mono text-[10px]">
                      (-{s.eliminated} filtered)
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Progress Bar */}
              <div className="bg-surface-container-highest mt-2.5 h-2 w-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${widthPct}%` }}
                  transition={{ duration: 0.55, delay: idx * 0.08 }}
                  className={`h-full ${s.color}`}
                />
              </div>

              <p className="text-muted-foreground mt-2 font-mono text-[11px]">{s.detail}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

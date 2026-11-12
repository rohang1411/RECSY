'use client';

import React, { useState } from 'react';

export interface DayUsage {
  date: string; // YYYY-MM-DD
  queries?: number;
  charged?: number;
  notCharged?: number;
  total?: number;
}

export interface NormalizedDayUsage {
  date: string;
  queries: number;
}

export interface UsageStripProps {
  days?: readonly DayUsage[];
  className?: string;
}

export function UsageStrip({ days = [], className = '' }: UsageStripProps) {
  const [activeDay, setActiveDay] = useState<NormalizedDayUsage | null>(null);

  // Generate 30 days ending today if fewer days provided
  const normalizedDays: NormalizedDayUsage[] = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      const q =
        d.queries ??
        (typeof d.total === 'number' ? d.total : (d.charged ?? 0) + (d.notCharged ?? 0));
      map.set(d.date, q);
    }

    const result: NormalizedDayUsage[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - i);
      const key = d.toISOString().slice(0, 10);
      result.push({
        date: key,
        queries: map.get(key) ?? 0,
      });
    }
    return result;
  }, [days]);

  const totalQueries = normalizedDays.reduce((acc, d) => acc + d.queries, 0);
  const activeDaysCount = normalizedDays.filter((d) => d.queries > 0).length;

  const getCellIntensity = (queries: number) => {
    if (queries === 0) return 'bg-surface border-border-hairline hover:border-foreground/40';
    if (queries === 1) return 'bg-accent/20 border-accent/40 hover:bg-accent/30';
    if (queries === 2) return 'bg-accent/50 border-accent/70 hover:bg-accent/60';
    return 'bg-accent border-accent text-black hover:bg-accent-hover';
  };

  return (
    <div className={`border-border-hairline bg-surface border p-6 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Telemetry
          </div>
          <h4 className="text-foreground text-sm font-bold">30-Day Query Activity</h4>
        </div>
        <div className="text-muted-foreground flex items-center gap-4 font-mono text-xs">
          <span>{totalQueries} queries</span>
          <span>·</span>
          <span>{activeDaysCount} active days</span>
        </div>
      </div>

      {/* 30-Cell Grid */}
      <div
        role="grid"
        aria-label="30-day activity heatmap"
        className="grid grid-cols-10 gap-1.5 sm:grid-cols-15 md:grid-cols-30"
      >
        {normalizedDays.map((day) => (
          <button
            key={day.date}
            type="button"
            onMouseEnter={() => setActiveDay(day)}
            onFocus={() => setActiveDay(day)}
            onMouseLeave={() => setActiveDay(null)}
            onBlur={() => setActiveDay(null)}
            aria-label={`${day.date}: ${day.queries} queries`}
            className={`aspect-square w-full border transition-all ${getCellIntensity(
              day.queries,
            )} focus:ring-accent focus:ring-1 focus:outline-none`}
          />
        ))}
      </div>

      {/* Tooltip detail bar */}
      <div className="text-muted-foreground mt-4 flex h-6 items-center justify-between font-mono text-xs">
        <div>
          {activeDay ? (
            <span className="text-foreground">
              {activeDay.date}: <strong className="text-accent">{activeDay.queries}</strong> queries
            </span>
          ) : (
            <span>Hover or focus a cell for daily query details</span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase">
          <span>Less</span>
          <span className="border-border-hairline bg-surface inline-block h-2.5 w-2.5 border" />
          <span className="border-accent/40 bg-accent/20 inline-block h-2.5 w-2.5 border" />
          <span className="border-accent/70 bg-accent/50 inline-block h-2.5 w-2.5 border" />
          <span className="border-accent bg-accent inline-block h-2.5 w-2.5 border" />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}

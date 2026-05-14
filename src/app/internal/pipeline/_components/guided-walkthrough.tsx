'use client';

import { ChevronLeft, ChevronRight, Map, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const STEPS = [
  {
    target: 'pipeline-hero',
    title: 'Lifecycle Map',
    body: 'The top rail shows the live count at each stage, from catalog rows to recommendation usage.',
  },
  {
    target: 'corpus-overview',
    title: 'Corpus State',
    body: 'These cards summarize the current database surface area and freshness signals.',
  },
  {
    target: 'phone-evidence',
    title: 'Phone Evidence Lens',
    body: 'Pick a device and inspect its sources, chunks, scorecard rows, and ingest history.',
  },
  {
    target: 'retrieval-replay',
    title: 'Retrieval Replay',
    body: 'This deterministic replay shows how a question becomes ranked, cited context.',
  },
  {
    target: 'recommendation-replay',
    title: 'Recommendation Replay',
    body: 'The recommender panel explains extracted requirements, filtering, and final ranking.',
  },
  {
    target: 'database-map',
    title: 'Storage Contract',
    body: 'The final map ties every major table to the writers and readers in the pipeline.',
  },
] as const;

export function GuidedWalkthrough() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const step = STEPS[index];

  useEffect(() => {
    if (!open || !step) return;
    document
      .getElementById(step.target)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
  }, [open, step]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setIndex(0);
        }}
        className="border-border/70 bg-card/90 text-foreground fixed right-4 bottom-4 z-50 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm shadow-2xl shadow-black/30 backdrop-blur-xl"
      >
        <Map className="size-4" aria-hidden />
        Walkthrough
      </button>

      {open && step ? (
        <div className="pointer-events-none fixed inset-0 z-50">
          <div className="bg-background/55 absolute inset-0 backdrop-blur-[2px]" />
          <div className="border-border/70 bg-card pointer-events-auto absolute right-4 bottom-4 w-[min(24rem,calc(100vw-2rem))] rounded-lg border p-4 shadow-2xl shadow-black/40">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-muted-foreground font-mono text-[11px] uppercase">
                  Step {index + 1} of {STEPS.length}
                </p>
                <h3 className="text-foreground mt-1 text-lg font-semibold">{step.title}</h3>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground rounded-md p-1 transition"
                aria-label="Close walkthrough"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{step.body}</p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIndex((current) => Math.max(0, current - 1))}
                disabled={index === 0}
                className="border-border/70 text-foreground inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-45"
              >
                <ChevronLeft className="size-4" aria-hidden />
                Back
              </button>
              <div className="flex gap-1.5" aria-hidden>
                {STEPS.map((item, itemIndex) => (
                  <span
                    key={item.target}
                    className="h-1.5 w-6 rounded-full"
                    style={{
                      background:
                        itemIndex <= index
                          ? 'var(--primary)'
                          : 'color-mix(in oklch, var(--border) 75%, transparent)',
                    }}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (index === STEPS.length - 1) {
                    setOpen(false);
                  } else {
                    setIndex((current) => current + 1);
                  }
                }}
                className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm"
              >
                {index === STEPS.length - 1 ? 'Close' : 'Next'}
                <ChevronRight className="size-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

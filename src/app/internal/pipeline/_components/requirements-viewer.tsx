import { CheckCircle2, DollarSign, SlidersHorizontal } from 'lucide-react';

import type { RecommendationDemo } from '@/services/internal/recommend-explain';

export function RequirementsViewer({
  requirements,
}: {
  readonly requirements: RecommendationDemo['requirements'];
}) {
  return (
    <div className="border-border/60 bg-background/70 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-foreground flex items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal className="text-primary size-4" aria-hidden />
            Extracted Requirements
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Structured constraints stored with the recommendation turn.
          </p>
        </div>
        <span className="text-foreground border-border/60 bg-card/65 inline-flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs">
          <DollarSign className="size-3" aria-hidden />
          {requirements.budgetUsd.toLocaleString('en-US')}
        </span>
      </div>

      <div className="mt-3 grid gap-3">
        <RequirementBlock label="Priorities" items={requirements.priorities} />
        <RequirementBlock label="Must haves" items={requirements.mustHaves} />
        <RequirementBlock label="Accepted tradeoffs" items={requirements.tradeoffs} />
      </div>
    </div>
  );
}

function RequirementBlock({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly string[];
}) {
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 font-mono text-[11px] uppercase">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span
            key={item}
            className="border-border/60 bg-card/65 text-foreground inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          >
            <CheckCircle2 className="text-success size-3" aria-hidden />
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

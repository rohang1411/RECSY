import type { RecommendationPickDemo } from '@/services/internal/recommend-explain';

export function ScoreBreakdown({ pick }: { readonly pick: RecommendationPickDemo }) {
  const total = Math.max(
    pick.contributions.reduce((sum, contribution) => sum + contribution.value, 0),
    1,
  );

  return (
    <div>
      <div className="border-border/50 bg-background/70 flex overflow-hidden rounded-md border">
        {pick.contributions.map((contribution) => (
          <div
            key={contribution.label}
            className="h-3"
            style={{
              width: `${(contribution.value / total) * 100}%`,
              background: contribution.color,
            }}
            title={`${contribution.label}: ${contribution.value}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {pick.contributions.map((contribution) => (
          <span
            key={contribution.label}
            className="text-muted-foreground flex items-center gap-1 text-[11px]"
          >
            <span
              className="size-2 rounded-full"
              style={{ background: contribution.color }}
              aria-hidden
            />
            {contribution.label} {contribution.value}
          </span>
        ))}
      </div>
    </div>
  );
}

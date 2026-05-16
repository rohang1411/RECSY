import type { EvidenceAspect } from '@/services/internal/phone-evidence';

const ASPECTS = ['camera', 'battery', 'performance', 'display', 'build', 'software', 'value'];

export function ScorecardRadar({ aspects }: { readonly aspects: readonly EvidenceAspect[] }) {
  const points = getRadarPoints(aspects);
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  const latestUpdated = aspects
    .map((aspect) => aspect.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="border-border/60 bg-card/45 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-foreground text-sm font-semibold">Scorecard Radar</h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Aspect rows generated from retrieved evidence.
          </p>
        </div>
        <span className="text-muted-foreground font-mono text-[11px]">
          {latestUpdated ? formatDate(latestUpdated) : 'pending'}
        </span>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[14rem_1fr] lg:items-center">
        <div className="bg-background/70 border-border/50 rounded-lg border p-2">
          <svg
            viewBox="0 0 100 100"
            className="aspect-square w-full"
            role="img"
            aria-label="Scorecard radar"
          >
            {[0.25, 0.5, 0.75, 1].map((scale) => (
              <polygon
                key={scale}
                points={getRadarGrid(scale)}
                fill="none"
                stroke="color-mix(in oklch, var(--border) 70%, transparent)"
                strokeWidth="0.5"
              />
            ))}
            {points.map((point) => (
              <line
                key={point.aspect}
                x1="50"
                y1="50"
                x2={point.axisX}
                y2={point.axisY}
                stroke="color-mix(in oklch, var(--border) 65%, transparent)"
                strokeWidth="0.5"
              />
            ))}
            {polygon ? (
              <polygon
                points={polygon}
                fill="color-mix(in oklch, var(--primary) 28%, transparent)"
                stroke="var(--primary)"
                strokeWidth="1.2"
              />
            ) : null}
            {points.map((point) => (
              <g key={`${point.aspect}-label`}>
                <circle cx={point.x} cy={point.y} r="1.5" fill="var(--primary)" />
                <text
                  x={point.labelX}
                  y={point.labelY}
                  textAnchor={point.textAnchor}
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[4px]"
                >
                  {point.aspect}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {ASPECTS.map((aspect) => {
            const row = aspects.find((item) => item.aspect === aspect);
            return (
              <div key={aspect} className="bg-background/70 border-border/50 rounded-md border p-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-foreground text-xs font-medium capitalize">{aspect}</span>
                  <span className="font-mono text-xs">{row ? row.score.toFixed(1) : 'n/a'}</span>
                </div>
                <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                  <div
                    className="bg-primary h-full rounded-full"
                    style={{ width: `${row ? row.score * 10 : 0}%` }}
                  />
                </div>
                <p className="text-muted-foreground mt-2 line-clamp-2 text-[11px] leading-relaxed">
                  {row?.summary || 'No generated summary stored yet.'}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getRadarPoints(aspects: readonly EvidenceAspect[]) {
  return ASPECTS.map((aspect, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / ASPECTS.length;
    const stored = aspects.find((item) => item.aspect === aspect);
    const radius = 34 * ((stored?.score ?? 0) / 10);
    const axisRadius = 38;
    const labelRadius = 46;
    const axisX = 50 + Math.cos(angle) * axisRadius;
    const axisY = 50 + Math.sin(angle) * axisRadius;
    return {
      aspect,
      x: 50 + Math.cos(angle) * radius,
      y: 50 + Math.sin(angle) * radius,
      axisX,
      axisY,
      labelX: 50 + Math.cos(angle) * labelRadius,
      labelY: 50 + Math.sin(angle) * labelRadius,
      textAnchor:
        Math.abs(Math.cos(angle)) < 0.2 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end',
    } as const;
  });
}

function getRadarGrid(scale: number): string {
  return ASPECTS.map((_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / ASPECTS.length;
    const radius = 38 * scale;
    return `${50 + Math.cos(angle) * radius},${50 + Math.sin(angle) * radius}`;
  }).join(' ');
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
    new Date(value),
  );
}

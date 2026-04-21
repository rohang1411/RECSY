import { eq } from 'drizzle-orm';

import { ASPECT_NAMES, type AspectName } from '@/lib/constants';
import { getDb } from '@/services/db/client';
import { aspectDefinitions, aspects } from '@/services/db/schema';

function labelForAspect(aspect: AspectName): string {
  return aspect.charAt(0).toUpperCase() + aspect.slice(1);
}

export async function ScorecardSection({ phoneId }: { readonly phoneId: string }) {
  const db = getDb();
  const rows = await db
    .select({
      aspect: aspectDefinitions.aspect,
      score: aspects.score,
      confidence: aspects.confidence,
      summary: aspects.summary,
      nSupporting: aspects.nSupporting,
      nDissenting: aspects.nDissenting,
    })
    .from(aspects)
    .innerJoin(aspectDefinitions, eq(aspects.aspectDefinitionId, aspectDefinitions.id))
    .where(eq(aspects.phoneId, phoneId));

  if (rows.length === 0) {
    return null;
  }

  const byAspect = new Map(rows.map((r) => [r.aspect as AspectName, r]));

  return (
    <section
      aria-labelledby="scorecard-heading"
      className="border-border/80 bg-muted/15 border-t px-4 py-10 sm:px-6"
    >
      <div className="mx-auto max-w-3xl">
        <h2 id="scorecard-heading" className="text-foreground text-xl font-semibold tracking-tight">
          Consensus scorecard
        </h2>
        <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
          Seven-axis scores derived from ingested reviews. Each row summarises what reviewers agree
          on and where they disagree.
        </p>

        <ul className="divide-border/80 border-border/80 bg-background mt-8 divide-y rounded-lg border">
          {ASPECT_NAMES.map((key) => {
            const row = byAspect.get(key);
            if (!row) {
              return (
                <li
                  key={key}
                  className="flex flex-col gap-1 px-4 py-4 sm:flex-row sm:items-baseline sm:justify-between"
                >
                  <span className="text-foreground font-medium">{labelForAspect(key)}</span>
                  <span className="text-muted-foreground text-sm">Not scored yet</span>
                </li>
              );
            }
            const confPct = Math.round(Number.parseFloat(row.confidence) * 100);
            return (
              <li key={key} className="px-4 py-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <span className="text-foreground font-medium">{labelForAspect(key)}</span>
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                    <span className="text-foreground tabular-nums">
                      <span className="font-semibold">{row.score}</span>
                      <span className="text-muted-foreground"> / 10</span>
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      Confidence {Number.isFinite(confPct) ? `${confPct}%` : row.confidence}
                    </span>
                    <span className="text-muted-foreground">
                      +{row.nSupporting} / −{row.nDissenting} evidence
                    </span>
                  </div>
                </div>
                {row.summary ? (
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {row.summary}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

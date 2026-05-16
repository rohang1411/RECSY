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
      className="border-outline-variant px-grid-margin border-t py-10"
    >
      <div className="border-outline-variant bg-background border">
        <div className="border-outline-variant border-b p-5">
          <p className="meta-label">Review consensus</p>
          <h2
            id="scorecard-heading"
            className="font-display text-primary mt-3 text-4xl font-extrabold tracking-normal uppercase"
          >
            Scorecard
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
            Seven-axis scores derived from ingested reviews. Rows expose agreement, dissent, and
            confidence without adding visual softness.
          </p>
        </div>

        <ul className="divide-outline-variant divide-y">
          {ASPECT_NAMES.map((key, index) => {
            const row = byAspect.get(key);
            if (!row) {
              return (
                <li key={key} className="bg-outline-variant grid gap-px sm:grid-cols-12">
                  <span className="bg-background text-muted-foreground p-4 font-mono text-[11px] tracking-[0.16em] uppercase sm:col-span-3">
                    Aspect {String(index + 1).padStart(2, '0')}: {labelForAspect(key)}
                  </span>
                  <span className="bg-background text-muted-foreground p-4 text-sm sm:col-span-9">
                    Not scored yet
                  </span>
                </li>
              );
            }
            const confPct = Math.round(Number.parseFloat(row.confidence) * 100);
            return (
              <li key={key} className="bg-outline-variant grid gap-px sm:grid-cols-12">
                <div className="bg-background p-4 sm:col-span-3">
                  <p className="meta-label">Aspect {String(index + 1).padStart(2, '0')}</p>
                  <p className="text-primary mt-2 text-sm font-medium">{labelForAspect(key)}</p>
                </div>
                <div className="bg-background p-4 sm:col-span-2">
                  <p className="font-display text-primary text-5xl font-extrabold">{row.score}</p>
                  <p className="meta-label mt-1">/10</p>
                </div>
                <div className="bg-background p-4 sm:col-span-3">
                  <p className="text-muted-foreground font-mono text-xs">
                    Confidence: {Number.isFinite(confPct) ? `${confPct}%` : row.confidence}
                  </p>
                  <p className="text-muted-foreground mt-2 font-mono text-xs">
                    Evidence: +{row.nSupporting} / -{row.nDissenting}
                  </p>
                </div>
                <div className="bg-background p-4 sm:col-span-4">
                  {row.summary ? (
                    <p className="text-muted-foreground text-sm leading-6">{row.summary}</p>
                  ) : (
                    <p className="text-muted-foreground text-sm">No summary available.</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

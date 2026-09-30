import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, Eye, Scale } from 'lucide-react';

import { PhoneImage } from '@/components/phone/PhoneImage';
import { SideNav } from '@/components/ui/side-nav';
import { formatLocalPrice } from '@/lib/format-currency';
import { getActiveRegion } from '@/lib/get-active-region';
import { getDb } from '@/services/db/client';
import { getShareSnapshot } from '@/services/recommender/session-manager';
import type { RecommendApiPick } from '@/services/recommender/run-recommendation';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ token: string }>;
}

export default async function SharedRecommendationPage({ params }: PageProps) {
  const { token } = await params;
  const db = getDb();
  const result = await getShareSnapshot(db, token);

  if (!result) {
    notFound();
  }

  const activeRegion = await getActiveRegion();
  const { share, frozenState } = result;
  const session = frozenState.session;
  const turns = frozenState.turns || [];
  const latestTurn = turns[turns.length - 1];
  const picks: RecommendApiPick[] = (latestTurn?.picks as RecommendApiPick[]) || [];
  const topPick = picks[0];
  const runnerUps = picks.slice(1);

  return (
    <div className="bg-background flex min-h-dvh">
      <SideNav active="/recommend" />
      <div className="grid-bg flex min-w-0 flex-1 flex-col">
        <header className="border-outline-variant px-grid-margin border-b py-8 sm:py-12">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="meta-label border-primary mb-3 border-l-2 pl-4">
                Shared Recommendation
              </p>
              <h1 className="heading-scanline text-gradient-accent-edge font-display text-3xl font-extrabold tracking-normal break-words uppercase sm:text-5xl">
                {session.title || 'Phone Recommendation'}
              </h1>
              <p className="text-muted-foreground mt-3 flex items-center gap-3 font-mono text-xs">
                <span>Created {new Date(session.createdAt).toLocaleDateString()}</span>
                <span>•</span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="size-3" />
                  {share.viewsCount} views
                </span>
              </p>
            </div>
            <Link
              href="/recommend"
              className="border-outline text-primary hover:bg-primary hover:text-background inline-flex items-center gap-2 border px-4 py-2.5 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              Start Your Own Search
              <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </header>

        <main className="px-grid-margin flex-1 py-8">
          {latestTurn && (
            <div className="border-outline-variant bg-surface-container/50 text-primary mb-8 border p-5 font-mono text-sm leading-relaxed">
              <span className="text-muted-foreground mb-1 block text-xs tracking-wider uppercase">
                User Query
              </span>
              &ldquo;{latestTurn.userMessage}&rdquo;
            </div>
          )}

          {picks.length > 0 ? (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <p className="meta-label text-primary">Top Recommendations</p>
                {picks.length >= 2 && (
                  <Link
                    href={`/compare?a=${encodeURIComponent(picks[0]!.slug)}&b=${encodeURIComponent(picks[1]!.slug)}`}
                    className="border-outline text-primary hover:bg-primary hover:text-background inline-flex items-center gap-2 border px-3 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
                  >
                    <Scale className="size-3.5" />
                    Compare Top 2
                  </Link>
                )}
              </div>

              <div className="bg-outline-variant grid gap-px lg:grid-cols-12">
                {topPick && (
                  <Link
                    href={`/p/${topPick.slug}`}
                    className="interactive-panel group relative overflow-hidden p-6 focus-visible:outline-none lg:col-span-8"
                  >
                    <div className="flex items-start justify-between">
                      <span className="border-primary text-primary border px-2 py-1 font-mono text-xs">
                        Rank 1 • Top Pick
                      </span>
                      <span className="text-primary font-mono text-sm font-bold">
                        {topPick.score.toFixed(2)}
                      </span>
                    </div>
                    <PhoneImage
                      src={topPick.imageUrl}
                      label={`${topPick.brand} ${topPick.model}`}
                      size={240}
                      className="mx-auto my-6 h-56 w-56 object-contain"
                    />
                    <p className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                      {topPick.brand}
                    </p>
                    <h3 className="font-display text-gradient-steel mt-1 text-4xl font-bold uppercase">
                      {topPick.model}
                    </h3>
                    <p className="text-primary mt-2 font-mono text-sm">
                      {formatLocalPrice(topPick.localPrice ?? topPick.msrpUsd, activeRegion)}
                    </p>
                    <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
                      {topPick.summary}
                    </p>
                  </Link>
                )}

                <div className="bg-outline-variant grid gap-px lg:col-span-4">
                  {runnerUps.map((pick, i) => (
                    <Link
                      key={pick.phoneId}
                      href={`/p/${pick.slug}`}
                      className="interactive-panel group relative overflow-hidden p-5 focus-visible:outline-none"
                    >
                      <div className="flex items-start justify-between">
                        <span className="border-primary text-primary border px-2 py-0.5 font-mono text-[10px]">
                          Rank {i + 2}
                        </span>
                        <span className="text-primary font-mono text-xs font-bold">
                          {pick.score.toFixed(2)}
                        </span>
                      </div>
                      <PhoneImage
                        src={pick.imageUrl}
                        label={`${pick.brand} ${pick.model}`}
                        size={120}
                        className="mx-auto my-3 h-28 w-28 object-contain"
                      />
                      <p className="text-muted-foreground font-mono text-[10px] uppercase">
                        {pick.brand}
                      </p>
                      <h4 className="font-display text-gradient-steel text-xl font-bold uppercase">
                        {pick.model}
                      </h4>
                      <p className="text-primary mt-1 font-mono text-xs">
                        {formatLocalPrice(pick.localPrice ?? pick.msrpUsd, activeRegion)}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="interactive-panel text-muted-foreground p-10 text-center font-mono text-sm">
              No recommendations available in this snapshot.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

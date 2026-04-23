import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'What RECSY is, how it works, and who it is for.',
};

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-foreground text-3xl font-semibold tracking-tight">About RECSY v2</h1>
      <p className="text-muted-foreground mt-4 text-sm leading-relaxed">
        RECSY is a web experiment in honest smartphone shopping: a conversational recommender (your
        words → structured needs → three ranked picks) and per-phone pages with a review-grounded
        aspect scorecard and Q&amp;A, so claims stay tied to real sources.
      </p>
      <h2 className="text-foreground mt-8 text-lg font-semibold">What to try</h2>
      <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1 text-sm">
        <li>
          <Link className="text-primary font-medium hover:underline" href="/recommend">
            Find a phone
          </Link>{' '}
          — multi-turn chat intake and picks
        </li>
        <li>
          <Link className="text-primary font-medium hover:underline" href="/browse">
            Browse
          </Link>{' '}
          — filter the catalog by brand, price, form factor
        </li>
        <li>Any phone page — key specs, scorecard, and cited chat (when data exists)</li>
        <li>
          <Link className="text-primary font-medium hover:underline" href="/compare">
            Compare two phones
          </Link>{' '}
          — open <code className="text-foreground">/compare</code> and add{' '}
          <code className="text-foreground">?a=slug&b=slug</code>, or use Compare from the
          recommender
        </li>
      </ul>
      <h2 className="text-foreground mt-8 text-lg font-semibold">Honest note</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        This is a learning / portfolio build: the goal is solid engineering and transparent UX, not
        to replace general-purpose AIs. Recommendations and scores are only as good as the seeded
        corpus and ingested review coverage in your environment.
      </p>
    </div>
  );
}

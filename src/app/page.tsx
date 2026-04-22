import { ArrowRight, BookOpen, GitCompare, MessageCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Landing hero — primary CTA routes to Phase 5 recommender (`/recommend`).
 *
 * Design notes:
 *   - Uses design tokens only — no hard-coded hex values.
 *   - Respects `prefers-reduced-motion` (animations globally short-circuited
 *     in `globals.css`).
 *   - Uses semantic landmarks (`section`, `h1`, `h2`) for a11y + SEO.
 */
export default function HomePage() {
  return (
    <section className="relative overflow-hidden">
      {/* Soft ambient blob — purely decorative */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 flex justify-center opacity-30"
      >
        <div className="bg-primary/40 h-[320px] w-[520px] rounded-full blur-[140px]" />
      </div>

      <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 sm:py-24">
        <span
          className={cn(
            'border-border/80 bg-card/60 text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs backdrop-blur',
          )}
        >
          <Sparkles className="text-primary size-3.5" aria-hidden />
          Conversational recommender is live
        </span>

        <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl md:text-6xl">
          Tell us what matters.{' '}
          <span className="bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--accent)] bg-clip-text text-transparent">
            We&rsquo;ll find the phone.
          </span>
        </h1>

        <p className="text-muted-foreground mt-5 max-w-xl text-base text-pretty sm:text-lg">
          RECSY reads the reviews so you don&rsquo;t have to. Ask in plain English, get picks
          grounded in real-world testing &mdash; every claim traceable to the clip that said it.
        </p>

        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <Link
            href="/recommend"
            className="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Find my phone
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <Link
            href="/browse"
            className="border-border bg-card hover:bg-secondary text-foreground focus-visible:ring-ring inline-flex h-11 items-center justify-center rounded-md border px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Browse phones
          </Link>
        </div>

        <div className="border-border/60 from-card/40 to-background mt-20 grid max-w-4xl grid-cols-1 gap-4 rounded-2xl border bg-gradient-to-b p-6 text-left sm:grid-cols-3">
          <div className="sm:col-span-3">
            <h2 className="text-foreground text-sm font-semibold tracking-tight">
              What you can do
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Everything below ties back to the same review-backed catalog — use whichever entry
              point fits.
            </p>
          </div>
          <Link
            href="/recommend"
            className="border-border/80 bg-card/60 hover:border-primary/30 focus-visible:ring-ring group rounded-xl border p-4 transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <MessageCircle
              className="text-primary size-5 transition group-hover:scale-105"
              aria-hidden
            />
            <p className="text-foreground mt-2 text-sm font-medium">Recommender chat</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              Turn budget and priorities into three picks, with prices and images when we have them.
            </p>
          </Link>
          <Link
            href="/browse"
            className="border-border/80 bg-card/60 hover:border-primary/30 focus-visible:ring-ring group rounded-xl border p-4 transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <BookOpen
              className="text-primary size-5 transition group-hover:scale-105"
              aria-hidden
            />
            <p className="text-foreground mt-2 text-sm font-medium">Browse &amp; filters</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              Skim the seed catalog, open a phone page, and ask Q&amp;A scoped to that device.
            </p>
          </Link>
          <Link
            href="/compare"
            className="border-border/80 bg-card/60 hover:border-primary/30 focus-visible:ring-ring group rounded-xl border p-4 transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <GitCompare
              className="text-primary size-5 transition group-hover:scale-105"
              aria-hidden
            />
            <p className="text-foreground mt-2 text-sm font-medium">Compare</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              Side-by-side two models from the catalog (pickers or URL slugs).
            </p>
          </Link>
        </div>
      </div>
    </section>
  );
}

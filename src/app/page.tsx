import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Marketing placeholder for the landing page. The real conversational intake
 * (Phase 5) will replace this hero with a chat-first experience.
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
          Phase 0 scaffold is live
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
      </div>
    </section>
  );
}

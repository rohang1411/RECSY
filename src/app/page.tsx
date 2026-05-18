import { ArrowRight, BookOpen, GitCompare, Terminal } from 'lucide-react';
import Link from 'next/link';

const flows = [
  {
    n: '01',
    title: 'Recommend',
    href: '/recommend',
    body: 'Convert budget, priorities, and deal-breakers into a ranked shortlist.',
  },
  {
    n: '02',
    title: 'Browse',
    href: '/browse',
    body: 'Scan the active device manifest by brand, price, and form factor.',
  },
  {
    n: '03',
    title: 'Compare',
    href: '/compare',
    body: 'Place two catalog entries into a strict side-by-side spec matrix.',
  },
] as const;

export default function HomePage() {
  return (
    <div className="grid-bg">
      <section className="px-grid-margin flex min-h-[calc(100dvh-4rem)] items-center py-8 sm:py-10 lg:py-12">
        <div className="grid w-full gap-8 lg:grid-cols-12 lg:items-end">
          <div className="lg:col-span-9">
            <p className="meta-label border-primary mb-6 inline-flex border-l-2 pl-4">
              Conversational recommender
            </p>
            <h1 className="display-heading max-w-6xl">
              Ask what matters. We&apos;ll find the phone.
            </h1>

            <div className="border-outline-variant bg-background mt-10 grid border lg:grid-cols-[1fr_auto]">
              <Link
                href="/recommend"
                className="group hover:bg-surface-container flex min-h-28 items-center gap-4 p-5 transition-colors duration-150"
              >
                <Terminal className="text-primary size-5 shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="meta-label">Start a recommendation</p>
                  <p className="text-primary mt-2 truncate font-mono text-sm">
                    Describe your budget, favorite features, and must-haves.
                  </p>
                </div>
                <ArrowRight className="text-muted-foreground group-hover:text-primary size-5 shrink-0 transition" />
              </Link>
              <Link
                href="/recommend"
                className="border-outline-variant text-primary hover:bg-primary hover:text-background flex items-center justify-center border-t px-8 py-5 font-mono text-[11px] tracking-[0.18em] uppercase transition-colors duration-150 lg:border-t-0 lg:border-l"
              >
                Recommend
              </Link>
            </div>
          </div>
          <div className="border-outline-variant bg-background/80 border p-5 lg:col-span-3">
            <p className="meta-label">What RECSY does</p>
            <p className="text-muted-foreground mt-4 text-sm leading-6">
              RECSY reads the review-backed catalog, extracts structured needs, and returns phone
              picks with transparent reasoning.
            </p>
          </div>
        </div>
      </section>

      <section className="border-outline-variant px-grid-margin border-t py-12">
        <div className="bg-outline-variant grid gap-px md:grid-cols-3">
          {flows.map((flow, index) => (
            <Link
              key={flow.href}
              href={flow.href}
              className="group bg-background hover:bg-surface-container relative min-h-72 overflow-hidden p-6 transition-colors duration-150"
            >
              <p className="font-display text-primary/10 text-[96px] leading-none font-extrabold tracking-normal">
                {flow.n}
              </p>
              <div className="absolute inset-x-6 bottom-6">
                <p className="meta-label mb-3">Step {flow.n}</p>
                <h2 className="font-display text-primary text-3xl font-bold tracking-normal uppercase">
                  {flow.title}
                </h2>
                <p className="text-muted-foreground mt-3 text-sm leading-6">{flow.body}</p>
                <p className="text-primary mt-6 inline-flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] uppercase">
                  {flow.title}
                  {index === 0 ? <ArrowRight className="size-3.5" /> : null}
                  {index === 1 ? <BookOpen className="size-3.5" /> : null}
                  {index === 2 ? <GitCompare className="size-3.5" /> : null}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

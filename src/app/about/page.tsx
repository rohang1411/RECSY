import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'About',
  description: 'What RECSY is, how it works, and who it is for.',
};

const entryPoints = [
  ['Recommend', '/recommend', 'Describe your needs and get a ranked shortlist.'],
  ['Browse', '/browse', 'Filter the active phone catalog by brand, price, and form factor.'],
  ['Phone details', '/browse', 'Open any phone for specs, scorecards, and cited Q&A.'],
  ['Compare', '/compare', 'Select two phones and review the side-by-side spec table.'],
] as const;

const principles = [
  ['Evidence first', 'Recommendations are grounded in catalog data and ingested review coverage.'],
  [
    'Plain-language input',
    'You do not need to know spec names. Say what matters in your own words.',
  ],
  [
    'Transparent uncertainty',
    'When review scorecards are missing or tied, RECSY says so directly.',
  ],
  [
    'Useful comparisons',
    'The compare page highlights measurable wins like battery, camera, and weight.',
  ],
] as const;

const scorecard = [
  ['Camera', 'Photo and video quality, low-light behavior, zoom, processing, and consistency.'],
  ['Battery', 'Realistic endurance, charging speed, standby drain, and long-day confidence.'],
  ['Performance', 'Chipset, sustained load, gaming headroom, thermals, and everyday smoothness.'],
  ['Display', 'Size, panel type, resolution, refresh rate, brightness, and readability.'],
  ['Build', 'Materials, durability, IP rating, ergonomics, weight, and hand feel.'],
  ['Software', 'Update policy, OS experience, bloat, ecosystem fit, and reliability.'],
  ['Value', 'How much phone you get for the price and how defensible the purchase is.'],
] as const;

export default function AboutPage() {
  return (
    <div className="grid-bg px-grid-margin py-10">
      <section className="border-outline-variant bg-background border p-6 sm:p-8">
        <p className="meta-label">About</p>
        <h1 className="font-display text-primary mt-5 text-5xl leading-none font-extrabold tracking-normal uppercase sm:text-7xl">
          About RECSY
        </h1>
        <p className="text-muted-foreground mt-6 max-w-3xl text-sm leading-6">
          RECSY is a review-aware smartphone recommendation platform. It turns natural-language
          needs such as budget, camera quality, battery life, size, gaming, or software priorities
          into structured preferences, then ranks phones from the active catalog.
        </p>
      </section>

      <section className="bg-outline-variant mt-8 grid gap-px lg:grid-cols-4">
        {entryPoints.map(([label, href, detail], index) => (
          <Link
            key={label}
            href={href}
            className="bg-background hover:bg-surface-container p-6 transition-colors"
          >
            <p className="meta-label">Step {String(index + 1).padStart(2, '0')}</p>
            <h2 className="font-display text-primary mt-4 text-3xl font-bold tracking-normal uppercase">
              {label}
            </h2>
            <p className="text-muted-foreground mt-3 text-sm leading-6">{detail}</p>
          </Link>
        ))}
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="border-outline-variant bg-background border p-6 lg:col-span-7">
          <p className="meta-label text-primary">Product philosophy</p>
          <h2 className="font-display text-primary mt-4 text-4xl font-bold tracking-normal uppercase">
            Helpful before technical
          </h2>
          <p className="text-muted-foreground mt-5 text-sm leading-6">
            The system is built for shoppers who know what they want from a phone, even if they do
            not know the exact spec sheet. A request like “under $800, great camera, strong battery,
            and not huge” is enough to start. RECSY translates that into a ranking, shows the
            strongest matches, and keeps comparison paths close by.
          </p>
          <div className="bg-outline-variant mt-6 grid gap-px sm:grid-cols-2">
            {principles.map(([title, body]) => (
              <div key={title} className="bg-background p-4">
                <h3 className="text-primary font-mono text-xs tracking-[0.14em] uppercase">
                  {title}
                </h3>
                <p className="text-muted-foreground mt-3 text-sm leading-6">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="border-outline-variant bg-surface-container relative min-h-[420px] overflow-hidden border lg:col-span-5">
          <div
            aria-hidden
            className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80')] bg-cover bg-center contrast-125 grayscale"
          />
          <div className="from-background via-background/70 to-background/20 absolute inset-0 bg-gradient-to-t" />
          <div className="absolute inset-x-0 bottom-0 p-6">
            <p className="meta-label text-primary">How it works</p>
            <p className="text-muted-foreground mt-4 text-sm leading-6">
              Catalog specs, ingested review sources, scorecards, and retrieval traces all feed the
              recommendation and phone Q&A experiences.
            </p>
          </div>
        </div>
      </section>

      <section className="border-outline-variant bg-background mt-8 border">
        <div className="border-outline-variant border-b p-6">
          <p className="meta-label text-primary">Scorecard aspects</p>
          <h2 className="font-display text-primary mt-4 text-4xl font-bold tracking-normal uppercase">
            What RECSY weighs
          </h2>
        </div>
        <div className="bg-outline-variant grid gap-px sm:grid-cols-2 xl:grid-cols-4">
          {scorecard.map(([title, body], index) => (
            <div
              key={title}
              className="bg-background hover:bg-surface-container p-5 transition-colors"
            >
              <p className="meta-label">Aspect {String(index + 1).padStart(2, '0')}</p>
              <h3 className="text-primary mt-4 font-mono text-sm tracking-[0.14em] uppercase">
                {title}
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-6">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-outline-variant bg-background mt-8 border p-6">
        <p className="meta-label text-primary">Honest note</p>
        <p className="text-muted-foreground mt-4 max-w-3xl text-sm leading-6">
          RECSY is only as good as the seeded catalog and available review coverage. When the data
          is thin, tied, or missing, the interface should make that visible instead of pretending
          the answer is more certain than it is.
        </p>
      </section>
    </div>
  );
}

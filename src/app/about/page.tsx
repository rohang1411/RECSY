import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, MessageSquareText, Scale, ShieldCheck } from 'lucide-react';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Why we built RECSY, how it works in plain English, and the engineering behind honest smartphone recommendations.',
};

const userPillars = [
  {
    icon: ShieldCheck,
    title: 'Zero Sponsored Bias',
    body: 'No paid brand deals, no affiliate commission kickbacks, and no hidden sponsorships. Picks are ranked purely on reviewer consensus and real-world testing.',
  },
  {
    icon: MessageSquareText,
    title: 'Plain English Input',
    body: 'You do not need to memorize chip models, aperture values, or display tech. Just talk like a human about what you need and what you want to spend.',
  },
  {
    icon: Scale,
    title: 'Radical Honesty',
    body: 'If two phones are tied for your needs, we tell you it is a tie and show both. If review data is still missing for a new model, we say so upfront instead of guessing.',
  },
] as const;

const steps = [
  {
    step: '01',
    title: 'You tell us what matters',
    body: 'Type your budget, your must-haves, your dealbreakers, or simply what frustrated you about your last phone. No technical jargon required.',
    href: '/recommend',
    actionLabel: 'Try the Recommender',
  },
  {
    step: '02',
    title: 'We search real review consensus',
    body: 'Our pipeline evaluates your priorities against verified lab tests, battery benchmarks, camera shootouts, and long-term durability impressions.',
    href: '/browse',
    actionLabel: 'Explore the Catalog',
  },
  {
    step: '03',
    title: 'You get transparent picks',
    body: 'A ranked shortlist that explains exactly why each device was selected, with side-by-side spec comparisons ready whenever you want to double-check.',
    href: '/compare',
    actionLabel: 'Compare Phones',
  },
] as const;

const aspects = [
  {
    title: 'Camera',
    whatYouCareAbout:
      'Crisp family photos, vibrant low-light shots, clean zoom, and video you actually want to rewatch.',
  },
  {
    title: 'Battery & Charging',
    whatYouCareAbout:
      'Effortlessly making it through a busy day on a single charge, without battery anxiety by early evening.',
  },
  {
    title: 'Everyday Speed',
    whatYouCareAbout:
      'Snappy app switching, zero lag while multitasking, and enough power to handle games without overheating.',
  },
  {
    title: 'Screen & Display',
    whatYouCareAbout:
      'Sharp readability even in blazing outdoor sunlight, fluid scrolling, and comfortable late-night viewing.',
  },
  {
    title: 'Build & Durability',
    whatYouCareAbout:
      'Comfortable hand ergonomics, premium materials, and IP water-resistance so drops and rain do not mean disaster.',
  },
  {
    title: 'Software & Longevity',
    whatYouCareAbout:
      'A clean OS free of annoying bloatware, regular security patches, and support for years into the future.',
  },
  {
    title: 'Real Value',
    whatYouCareAbout:
      'Getting the maximum phone quality for your money, whether your budget is $250 or $1,200.',
  },
] as const;

const creators = [
  {
    name: 'Rohan Sharma',
    image: '/creators/rohan.jpg',
    role: 'Lead Developer & Architect',
    body: 'Rohan built RECSY to solve a personal frustration: finding an honest smartphone shouldn’t take hours of wading through paid affiliate lists and complex spec sheets.',
    links: [
      ['Portfolio', 'https://rohang1411.github.io/'],
      ['RECSY Case Study', 'https://rohang1411.github.io/projects/recsy'],
      ['LinkedIn', 'https://www.linkedin.com/in/rohang1411/'],
    ],
  },
  {
    name: 'Milind Raj',
    image: '/creators/milind.jpg',
    role: 'Product & Design Partner',
    body: 'Milind focuses on making smartphone discovery intuitive and approachable, ensuring complex technical scorecards translate into clear, trustworthy decisions.',
    links: [['LinkedIn', 'https://www.linkedin.com/in/milindraj/']],
  },
] as const;

export default function AboutPage() {
  return (
    <div className="grid-bg px-grid-margin py-10">
      {/* Hero: Human, approachable tone */}
      <section className="border-outline-variant bg-background border p-6 sm:p-10">
        <p className="meta-label text-primary">About the project</p>
        <h1 className="heading-scanline text-gradient-accent-edge font-display mt-5 text-4xl leading-none font-extrabold tracking-normal uppercase sm:text-6xl lg:text-7xl">
          Built for real people, not spec sheets.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-3xl font-sans text-base leading-relaxed sm:text-lg">
          Buying a new smartphone has become exhausting. Every review site throws 20-page benchmark
          charts at you, and search results are flooded with sponsored articles pushing whatever
          device has the highest affiliate commission.
        </p>
        <p className="text-muted-foreground mt-4 max-w-3xl font-sans text-base leading-relaxed sm:text-lg">
          We built <strong className="text-foreground font-semibold">RECSY</strong> to cut through
          the noise. You just describe what you need in your own words, and we match you with the
          phone that actually fits your daily life—grounded in real consensus from verified tech
          reviewers.
        </p>

        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/recommend"
            className="border-outline text-primary hover:bg-primary hover:text-background inline-flex items-center gap-2 border px-6 py-3 font-mono text-xs tracking-[0.16em] uppercase transition-colors"
          >
            Start a recommendation
            <ArrowRight className="size-4" />
          </Link>
          <Link
            href="/browse"
            className="border-outline-variant text-muted-foreground hover:text-primary hover:border-primary inline-flex items-center gap-2 border px-6 py-3 font-mono text-xs tracking-[0.16em] uppercase transition-colors"
          >
            Browse all phones
          </Link>
        </div>
      </section>

      {/* 3 Core Pillars */}
      <section className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {userPillars.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <div
              key={pillar.title}
              className="border-outline-variant bg-background flex flex-col justify-between border p-6"
            >
              <div>
                <div className="border-primary text-primary inline-flex border p-2">
                  <Icon className="size-5" />
                </div>
                <h2 className="text-primary font-display mt-4 text-xl font-bold tracking-normal uppercase">
                  {pillar.title}
                </h2>
                <p className="text-muted-foreground mt-3 text-sm leading-6">{pillar.body}</p>
              </div>
            </div>
          );
        })}
      </section>

      {/* How it Works Section */}
      <section className="border-outline-variant bg-background mt-8 border p-6 sm:p-10">
        <div className="max-w-2xl">
          <p className="meta-label text-primary">How it works</p>
          <h2 className="text-gradient-steel font-display mt-4 text-3xl font-bold tracking-normal uppercase sm:text-5xl">
            From your words to the right pick
          </h2>
          <p className="text-muted-foreground mt-4 text-sm leading-6 sm:text-base">
            You don&apos;t need to know what a sensor aperture or an LTPO refresh controller is.
            Here is how RECSY turns what you care about into an honest recommendation:
          </p>
        </div>

        <div className="bg-outline-variant mt-8 grid gap-px md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.step} className="bg-background flex flex-col justify-between p-6">
              <div>
                <span className="font-display text-primary/20 text-5xl font-extrabold">
                  {s.step}
                </span>
                <h3 className="text-primary font-display mt-3 text-2xl font-bold uppercase">
                  {s.title}
                </h3>
                <p className="text-muted-foreground mt-3 text-sm leading-6">{s.body}</p>
              </div>
              <Link
                href={s.href}
                className="text-primary hover:text-accent mt-6 inline-flex items-center gap-1.5 font-mono text-xs tracking-wider uppercase transition-colors"
              >
                {s.actionLabel}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          ))}
        </div>

        {/* Featured Deep Dive / Portfolio Link Card */}
        <div className="border-accent bg-surface-container relative mt-8 overflow-hidden border-2 p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
            <div className="lg:col-span-8">
              <div className="flex items-center gap-2">
                <span className="bg-primary text-background px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest uppercase">
                  Engineering Deep Dive
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  From Rohan&apos;s Portfolio
                </span>
              </div>
              <h3 className="font-display text-primary mt-3 text-2xl font-extrabold uppercase sm:text-3xl">
                Behind the Architecture of RECSY
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-6">
                Want to see how this system was engineered under the hood? Rohan published an
                extensive case study covering everything from our deterministic multi-turn
                requirement guards, hybrid RAG retrieval pipelines, and real-time review aspect
                scoring algorithms.
              </p>
            </div>
            <div className="flex lg:col-span-4 lg:justify-end">
              <a
                href="https://rohang1411.github.io/projects/recsy"
                target="_blank"
                rel="noopener noreferrer"
                className="border-primary bg-primary text-background hover:bg-background hover:text-primary inline-flex items-center justify-center gap-2 border px-6 py-4 font-mono text-xs font-bold tracking-widest uppercase transition-all duration-150 focus-visible:outline-none"
              >
                <span>Read the Project Story</span>
                <ArrowUpRight className="size-4 shrink-0" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* What RECSY Actually Evaluates */}
      <section className="border-outline-variant bg-background mt-8 border p-6 sm:p-10">
        <div className="border-outline-variant border-b pb-6">
          <p className="meta-label text-primary">What we measure</p>
          <h2 className="font-display text-primary mt-3 text-3xl font-bold tracking-normal uppercase sm:text-4xl">
            The seven things that actually matter
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-sm leading-6">
            When tech reviewers test a phone for weeks, these are the real-world aspects we extract,
            score, and weight according to your preferences:
          </p>
        </div>

        <div className="bg-outline-variant mt-6 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          {aspects.map((asp, idx) => (
            <div
              key={asp.title}
              className="bg-background hover:bg-surface-container p-6 transition-colors"
            >
              <span className="text-accent font-mono text-[11px] font-bold tracking-widest uppercase">
                Aspect 0{idx + 1}
              </span>
              <h3 className="text-primary font-display mt-2 text-xl font-bold uppercase">
                {asp.title}
              </h3>
              <p className="text-muted-foreground mt-3 text-sm leading-6">{asp.whatYouCareAbout}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Creators Section */}
      <section className="mt-8">
        <div className="border-outline-variant mb-6 border-b pb-4">
          <p className="meta-label text-primary">Meet the creators</p>
          <h2 className="text-gradient-steel font-display mt-3 text-3xl font-bold tracking-normal uppercase sm:text-4xl">
            Built by engineers who wanted better recommendations
          </h2>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {creators.map((creator, index) => (
            <article
              key={creator.name}
              className="border-outline-variant bg-background relative overflow-hidden border p-6 sm:p-8"
            >
              <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={creator.image}
                  alt={creator.name}
                  className="border-outline size-28 shrink-0 border object-cover sm:size-32"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="meta-label text-accent">Creator 0{index + 1}</p>
                    <span className="text-muted-foreground font-mono text-[10px] uppercase">
                      {creator.role}
                    </span>
                  </div>
                  <h3 className="text-primary font-display mt-2 text-3xl font-bold uppercase">
                    {creator.name}
                  </h3>
                  <p className="text-muted-foreground mt-4 text-sm leading-6">{creator.body}</p>
                  <div className="mt-6 flex flex-wrap gap-2.5">
                    {creator.links.map(([label, href]) => (
                      <a
                        key={href}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-outline-variant bg-surface-container hover:border-primary hover:text-primary inline-flex items-center gap-1.5 border px-3 py-1.5 font-mono text-[11px] tracking-wider uppercase transition-colors"
                      >
                        <span>{label}</span>
                        <ArrowUpRight className="size-3" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Closing Honest Note */}
      <section className="border-outline-variant bg-background mt-8 border p-6 sm:p-8">
        <p className="meta-label text-primary">Our promise</p>
        <h3 className="text-primary font-display mt-2 text-2xl font-bold uppercase">
          Continuous updates, transparent scores.
        </h3>
        <p className="text-muted-foreground mt-4 max-w-3xl text-sm leading-6">
          RECSY is actively updated as new phones hit the market and trusted reviewers release their
          in-depth lab tests. If a phone is too new to have full review coverage, we tell you
          upfront rather than guessing. And if you ever spot a mistake or want to share feedback, we
          are always listening.
        </p>
      </section>
    </div>
  );
}

import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PricingGrid } from '@/components/billing/PricingGrid';
import { Accordion, type AccordionItem } from '@/components/ui/accordion';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';

export const metadata: Metadata = {
  title: 'Pricing & Quotas',
  description:
    'Transparent smartphone recommendations. 2 free daily queries for everyone, flexible non-expiring credit packs, or Pro monthly.',
};

interface FeatureRow extends Record<string, unknown> {
  feature: string;
  free: string;
  credits: string;
  pro: string;
  byok: string;
}

const COMPARISON_COLUMNS: DataTableColumn<FeatureRow>[] = [
  {
    key: 'feature',
    header: 'Plan Feature',
    className: 'font-mono text-xs font-semibold text-foreground',
  },
  {
    key: 'free',
    header: 'Free Daily',
    align: 'center',
    className: 'font-mono text-xs text-muted-foreground',
  },
  {
    key: 'credits',
    header: 'Credit Packs',
    align: 'center',
    className: 'font-mono text-xs text-muted-foreground',
  },
  {
    key: 'pro',
    header: 'Pro Monthly',
    align: 'center',
    className: 'font-mono text-xs font-bold text-accent',
  },
  {
    key: 'byok',
    header: 'BYOK',
    align: 'center',
    className: 'font-mono text-xs text-muted-foreground',
  },
];

const COMPARISON_DATA: FeatureRow[] = [
  {
    feature: 'Queries Included',
    free: '2 / calendar day',
    credits: '25 or 100 queries',
    pro: '150 / month',
    byok: 'Up to 100 / day',
  },
  {
    feature: 'Price',
    free: '$0',
    credits: '$3 (25) or $9 (100)',
    pro: '$9.99 / month',
    byok: 'Free of RECSY fee',
  },
  {
    feature: 'Effective Cost',
    free: '$0',
    credits: '$0.12 or $0.09 / query',
    pro: '~$0.066 / query',
    byok: 'Your provider rate',
  },
  {
    feature: 'Expiration',
    free: 'Resets daily 00:00 UTC',
    credits: 'Never expires',
    pro: 'Monthly billing cycle',
    byok: 'None',
  },
  {
    feature: 'Deep Reasoning Mode',
    free: 'Standard',
    credits: 'Standard',
    pro: 'Enabled (Full Depth)',
    byok: 'Model-dependent',
  },
  {
    feature: 'Max Concurrent Queries',
    free: '1',
    credits: '1',
    pro: '2 concurrent',
    byok: '1',
  },
  {
    feature: 'Cross-Device History',
    free: 'Local device only',
    credits: 'Local device only',
    pro: 'Synced to account',
    byok: 'Local device only',
  },
  {
    feature: 'Payment Method',
    free: 'None required',
    credits: 'Card via Stripe',
    pro: 'Card via Stripe',
    byok: 'Personal API key',
  },
];

const FAQ_ITEMS: AccordionItem[] = [
  {
    id: 'what-counts-query',
    title: 'What counts as a query?',
    content: (
      <p>
        A query is one completed smartphone recommendation or grounded Q&A answer delivered to your
        screen. Clarifying questions from our recommender, empty results, transient model errors,
        and cancelled requests are always 100% free and never charged to your allowance or credit
        balance.
      </p>
    ),
  },
  {
    id: 'when-resets',
    title: 'When do free queries reset?',
    content: (
      <p>
        Free queries reset every night at exactly 00:00 UTC (which corresponds to 05:30 IST, 17:00
        PDT, or 02:00 CEST). Our live composer HUD displays a real-time countdown to your next reset
        in your viewer&apos;s local timezone.
      </p>
    ),
  },
  {
    id: 'credits-expire',
    title: 'Do purchased credit packs expire?',
    content: (
      <p>
        No. Purchased credits remain in your account indefinitely and never expire. When you run
        queries, our atomic metering engine always consumes your 2 daily free queries first before
        touching your purchased credit balance.
      </p>
    ),
  },
  {
    id: 'cancel-pro',
    title: 'Can I cancel my Pro subscription at any time?',
    content: (
      <p>
        Yes, easily with one click. You can manage or cancel your subscription at any time via the
        Customer Portal in your Account settings. When cancelled, your Pro benefits remain fully
        active through the end of your current paid monthly billing period, and your card will not
        be billed again.
      </p>
    ),
  },
  {
    id: 'query-fails',
    title: 'What happens if a query fails or gets disconnected?',
    content: (
      <p>
        Our atomic metering engine uses a 2-phase reservation lease system. If our inference
        pipeline fails to produce a response, or if your connection drops before receiving the
        answer, the lease automatically expires or refunds the query back to your counter or credit
        balance. You will never be charged for an undelivered answer.
      </p>
    ),
  },
  {
    id: 'refunds',
    title: 'What is your refund policy?',
    content: (
      <p>
        Unused credit packs can be refunded in full within 14 calendar days of purchase. For Pro
        subscriptions, you can cancel anytime. Detailed information on dispute resolution and
        statutory EU/UK withdrawal rights can be reviewed in our{' '}
        <Link href="/refunds" className="text-accent hover:text-accent-hover underline">
          Refund Policy
        </Link>
        .
      </p>
    ),
  },
  {
    id: 'history-privacy',
    title: 'Do you store or sell my search history?',
    content: (
      <p>
        We never sell user data, search history, or personal telemetry to advertisers or data
        brokers. For anonymous users, searches stay strictly on your local device. For authenticated
        Pro users, session history is securely synced across your devices to enable persistent
        multi-turn research, and can be exported or permanently deleted at any time with one click.
      </p>
    ),
  },
  {
    id: 'payment-methods',
    title: 'Which payment methods are accepted?',
    content: (
      <p>
        All transactions are securely handled by Stripe. We accept all major debit and credit cards
        (Visa, Mastercard, American Express), Apple Pay, and Google Pay. All prices are denominated
        in USD ($) and converted at your financial institution&apos;s standard exchange rate.
      </p>
    ),
  },
];

export default function PricingPage() {
  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Hero Section */}
      <div className="border-border-hairline bg-surface border-b py-12 md:py-16">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="text-accent font-mono text-xs font-bold tracking-widest uppercase">
            Transparent Pricing & Quotas
          </div>
          <h1 className="text-foreground mt-3 text-3xl font-extrabold tracking-tight md:text-5xl">
            TWO FREE QUERIES. EVERY DAY.
          </h1>
          <p className="text-muted-foreground mt-3 max-w-2xl font-mono text-xs leading-relaxed md:text-sm">
            Honest smartphone intelligence with zero advertising bias. 2 free daily queries for
            everyone, flexible non-expiring credit packs, or Pro monthly for power users.
          </p>

          {/* Trust Anchor: What counts as a query? */}
          <div className="border-border-hairline bg-surface-elevated/60 mt-8 border p-4 md:p-5">
            <div className="flex flex-col gap-1 md:flex-row md:items-center md:gap-3">
              <span className="text-foreground font-mono text-xs font-bold tracking-wide uppercase">
                What counts as a query?
              </span>
              <span className="text-muted-foreground hidden md:inline">·</span>
              <span className="text-muted-foreground text-xs leading-relaxed">
                A query is one delivered recommendation or plain-English answer. Clarifying
                questions, empty results, network errors, and cancelled requests are always free.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Pricing Grids & Cards */}
      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 md:px-6 md:py-16">
        <section aria-labelledby="plans-heading">
          <h2 id="plans-heading" className="sr-only">
            Available Plans & Credit Packs
          </h2>
          <PricingGrid />
        </section>

        {/* Feature Comparison Table */}
        <section aria-labelledby="comparison-heading" className="space-y-6">
          <div>
            <div className="text-accent font-mono text-[11px] font-bold tracking-widest uppercase">
              Specifications
            </div>
            <h2
              id="comparison-heading"
              className="text-foreground text-2xl font-bold tracking-tight"
            >
              Feature Comparison
            </h2>
          </div>
          <DataTable
            columns={COMPARISON_COLUMNS}
            data={COMPARISON_DATA}
            caption="Comparison of Free, Credits, Pro, and BYOK capabilities"
          />
        </section>

        {/* FAQ Section */}
        <section aria-labelledby="faq-heading" className="space-y-6">
          <div>
            <div className="text-accent font-mono text-[11px] font-bold tracking-widest uppercase">
              Questions
            </div>
            <h2 id="faq-heading" className="text-foreground text-2xl font-bold tracking-tight">
              Frequently Asked Questions
            </h2>
          </div>
          <Accordion items={FAQ_ITEMS} allowMultiple />
        </section>

        {/* Legal micro-footer cluster */}
        <div className="border-border-hairline text-muted-foreground flex flex-wrap items-center justify-between gap-4 border-t pt-8 font-mono text-xs">
          <div>RECSY QUOTA SPECIFICATION · FAIR-USE SYSTEM</div>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-foreground uppercase transition-colors">
              Terms
            </Link>
            <span>·</span>
            <Link href="/privacy" className="hover:text-foreground uppercase transition-colors">
              Privacy
            </Link>
            <span>·</span>
            <Link href="/refunds" className="hover:text-foreground uppercase transition-colors">
              Refunds
            </Link>
            <span>·</span>
            <Link href="/contact" className="hover:text-foreground uppercase transition-colors">
              Contact
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

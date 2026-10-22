'use client';

import React from 'react';
import Link from 'next/link';
import { useQuota } from '@/components/quota/quota-store';
import { QuotaPips } from '@/components/quota/QuotaPips';
import { ResetCountdown } from '@/components/quota/ResetCountdown';
import { openAuthSheet } from '@/components/auth/AuthSheet';

export default function AccountOverviewPage() {
  const quota = useQuota();

  if (!quota.signedIn) {
    return (
      <div className="border-border-hairline bg-surface border p-8 text-center md:p-12">
        <div className="text-accent mb-2 font-mono text-xs tracking-wider uppercase">
          Signed Out
        </div>
        <h2 className="text-foreground text-2xl font-bold">Sign In to View Your Account</h2>
        <p className="text-muted-foreground mx-auto mt-2 max-w-md font-mono text-xs leading-relaxed">
          Access your daily quota telemetry, billing history, credit balances, and cross-device
          search history.
        </p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => openAuthSheet({ reason: 'header' })}
            className="border-accent bg-accent hover:bg-accent-hover border px-6 py-2.5 font-mono text-xs font-bold tracking-wider text-black uppercase transition-colors"
          >
            Sign In Now
          </button>
        </div>
      </div>
    );
  }

  const isPro = quota.isSubscriber;
  const credits = quota.credits;

  return (
    <div className="space-y-6">
      {/* Identity & Status Strip */}
      <div className="border-border-hairline bg-surface border p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Account Identity
            </div>
            <h2 className="text-foreground mt-1 font-mono text-xl font-bold">Active Member</h2>
            <div className="text-muted-foreground mt-0.5 font-mono text-xs">
              Verified User Session
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="border-border-hairline bg-surface-elevated text-text-primary border px-3 py-1 font-mono text-xs tracking-wider uppercase">
              {isPro ? 'Pro Member' : credits > 0 ? 'Credit Holder' : 'Free Tier'}
            </span>
          </div>
        </div>
      </div>

      {/* Today's Quota Instrument */}
      <div className="border-border-hairline bg-surface border p-6">
        <div className="border-border-hairline mb-5 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Today&apos;s Quota Gauge
            </div>
            <h3 className="text-foreground text-base font-bold">Query Capacity</h3>
          </div>
          <QuotaPips allowance={quota.freeAllowance} remaining={quota.freeRemaining} />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <div className="text-muted-foreground font-mono text-xs uppercase">
              Current Available Balance
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-foreground font-mono text-3xl font-extrabold">
                {isPro ? quota.subRemaining : quota.freeRemaining}
              </span>
              <span className="text-muted-foreground font-mono text-xs">
                {isPro ? 'Pro monthly queries remaining' : 'Daily free queries remaining'}
              </span>
            </div>
            {credits > 0 && (
              <div className="text-accent mt-2 font-mono text-xs">
                + {credits} purchased credits (never expires)
              </div>
            )}
          </div>

          <div className="border-border-hairline border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            <div className="text-muted-foreground font-mono text-xs uppercase">
              Daily Reset Clock
            </div>
            <div className="mt-1">
              <ResetCountdown resetAt={quota.resetAt} />
            </div>
          </div>
        </div>
      </div>

      {/* Plan Details & Actions */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="border-border-hairline bg-surface flex flex-col justify-between border p-6">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Subscription Status
            </div>
            <h3 className="text-foreground mt-1 text-lg font-bold">
              {isPro ? 'RECSY Pro Plan' : 'Free Daily Plan'}
            </h3>
            <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
              {isPro
                ? '150 monthly queries with deep reasoning mode and cross-device multi-turn history.'
                : '2 queries every calendar day. Resets every night at 00:00 UTC.'}
            </p>
          </div>

          <div className="border-border-hairline mt-6 border-t pt-4">
            <Link
              href={isPro ? '/account/billing' : '/pricing'}
              className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs tracking-wider uppercase transition-colors"
            >
              {isPro ? 'Manage Subscription' : 'Upgrade to Pro'}
            </Link>
          </div>
        </div>

        <div className="border-border-hairline bg-surface flex flex-col justify-between border p-6">
          <div>
            <div className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
              Credit Balance
            </div>
            <h3 className="text-foreground mt-1 text-lg font-bold">{credits} Query Credits</h3>
            <p className="text-muted-foreground mt-2 font-mono text-xs leading-relaxed">
              Purchased credit packs that never expire. Automatically used if your daily free
              queries run out.
            </p>
          </div>

          <div className="border-border-hairline mt-6 border-t pt-4">
            <Link
              href="/pricing"
              className="border-accent bg-accent/10 text-accent hover:bg-accent inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs font-bold tracking-wider uppercase transition-colors hover:text-black"
            >
              Buy More Credits
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

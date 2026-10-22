'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { quotaStore } from '@/components/quota/quota-store';

export type ReturnStatusType =
  | 'paid'
  | 'pro_active'
  | 'processing'
  | 'failed'
  | 'canceled'
  | 'not_found';

interface ReturnStatusProps {
  initialStatus: ReturnStatusType;
  creditsAdded?: number;
  productName?: string;
}

export function ReturnStatus({
  initialStatus,
  creditsAdded = 25,
  productName = 'Credit Pack',
}: ReturnStatusProps) {
  const [status, setStatus] = useState<ReturnStatusType>(initialStatus);
  const [displayCount, setDisplayCount] = useState(0);

  // Poll for status update if initially processing
  useEffect(() => {
    if (status !== 'processing') return;

    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch('/api/me/entitlements');
        if (res.ok) {
          const data = await res.json();
          if (data.isSubscriber) {
            setStatus('pro_active');
            quotaStore.refresh();
            clearInterval(interval);
          } else if (data.credits > 0) {
            setStatus('paid');
            quotaStore.refresh();
            clearInterval(interval);
          }
        }
      } catch {
        // Ignore polling network glitches
      }

      if (attempts >= 15) {
        clearInterval(interval);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [status]);

  // Tabular count-up animation on 'paid' state (520ms)
  useEffect(() => {
    if (status === 'paid' && creditsAdded > 0) {
      const startTime = performance.now();
      const duration = 520;

      const updateCount = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        setDisplayCount(Math.round(progress * creditsAdded));

        if (progress < 1) {
          requestAnimationFrame(updateCount);
        }
      };

      requestAnimationFrame(updateCount);
    }
  }, [status, creditsAdded]);

  if (status === 'paid') {
    return (
      <div className="border-border-hairline bg-surface animate-in fade-in border p-8 text-center duration-300 md:p-12">
        <div className="text-accent mb-2 font-mono text-xs font-bold tracking-widest uppercase">
          Success
        </div>
        <h1 className="text-foreground text-3xl font-extrabold tracking-tight md:text-5xl">
          <span className="font-mono tabular-nums">{displayCount}</span> CREDITS ADDED
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md font-mono text-xs leading-relaxed">
          Your payment for {productName} was confirmed. Your credits never expire and are ready to
          use immediately.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/recommend"
            className="border-accent bg-accent hover:bg-accent-hover border px-6 py-3 font-mono text-xs font-bold tracking-wider text-black uppercase transition-colors"
          >
            Start a Search
          </Link>
          <Link
            href="/account"
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-6 py-3 font-mono text-xs tracking-wider uppercase transition-colors"
          >
            View Account
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'pro_active') {
    return (
      <div className="border-accent bg-surface animate-in fade-in border p-8 text-center duration-300 md:p-12">
        <div className="text-accent mb-2 font-mono text-xs font-bold tracking-widest uppercase">
          Pro Activated
        </div>
        <h1 className="text-foreground text-3xl font-extrabold tracking-tight md:text-5xl">
          PRO IS ACTIVE
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md font-mono text-xs leading-relaxed">
          Welcome to RECSY Pro. You now have 150 monthly queries, deep reasoning mode, and
          cross-device history.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/recommend"
            className="border-accent bg-accent hover:bg-accent-hover border px-6 py-3 font-mono text-xs font-bold tracking-wider text-black uppercase transition-colors"
          >
            Start a Search
          </Link>
          <Link
            href="/account/billing"
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-6 py-3 font-mono text-xs tracking-wider uppercase transition-colors"
          >
            Manage Subscription
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'processing') {
    return (
      <div className="border-border-hairline bg-surface border p-8 text-center md:p-12">
        <div className="text-muted-foreground mb-2 font-mono text-xs font-bold tracking-widest uppercase">
          Confirmation Pending
        </div>
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight md:text-4xl">
          PAYMENT PROCESSING
        </h1>
        {/* Indeterminate 1px Scan Beam */}
        <div className="bg-border-hairline relative mx-auto my-6 h-[1px] max-w-xs overflow-hidden">
          <div className="bg-accent absolute inset-y-0 w-24 animate-[pulse_1.5s_infinite]" />
        </div>
        <p className="text-muted-foreground mx-auto max-w-md font-mono text-xs leading-relaxed">
          Some payment methods take a few minutes to clear. We will email you a receipt and add
          credits automatically once confirmed.
        </p>

        <div className="mt-8">
          <Link
            href="/account"
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-5 py-2.5 font-mono text-xs tracking-wider uppercase transition-colors"
          >
            Go to Account
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className="border-destructive/60 bg-surface border p-8 text-center md:p-12">
        <div className="text-destructive mb-2 font-mono text-xs font-bold tracking-widest uppercase">
          Transaction Incomplete
        </div>
        <h1 className="text-foreground text-2xl font-extrabold tracking-tight md:text-4xl">
          PAYMENT DIDN&apos;T GO THROUGH
        </h1>
        <p className="text-muted-foreground mx-auto mt-3 max-w-md font-mono text-xs leading-relaxed">
          Your card was not charged. You can retry with a different payment method or return to
          pricing.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/pricing"
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-6 py-3 font-mono text-xs tracking-wider uppercase transition-colors"
          >
            Return to Pricing
          </Link>
          <Link
            href="/contact"
            className="border-border-hairline bg-surface text-muted-foreground hover:text-foreground border px-6 py-3 font-mono text-xs tracking-wider uppercase transition-colors"
          >
            Contact Support
          </Link>
        </div>
      </div>
    );
  }

  // canceled / not_found
  return (
    <div className="border-border-hairline bg-surface border p-8 text-center md:p-12">
      <div className="text-muted-foreground mb-2 font-mono text-xs font-bold tracking-widest uppercase">
        Checkout Ended
      </div>
      <h1 className="text-foreground text-2xl font-extrabold tracking-tight md:text-4xl">
        CHECKOUT CANCELED
      </h1>
      <p className="text-muted-foreground mx-auto mt-3 max-w-md font-mono text-xs leading-relaxed">
        Nothing was charged. Your 2 free daily queries remain active and ready to use.
      </p>

      <div className="mt-8">
        <Link
          href="/"
          className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground border px-6 py-3 font-mono text-xs tracking-wider uppercase transition-colors"
        >
          Back to RECSY
        </Link>
      </div>
    </div>
  );
}

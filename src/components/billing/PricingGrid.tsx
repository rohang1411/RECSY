'use client';

import React from 'react';
import Link from 'next/link';
import { CheckoutButton } from './CheckoutButton';

export function PricingGrid() {
  return (
    <div className="space-y-6">
      {/* 3-Column Plan Grid */}
      <div className="border-border-hairline bg-border-hairline grid gap-px border md:grid-cols-3">
        {/* FREE TIER */}
        <div className="bg-surface flex flex-col justify-between p-6 md:p-8">
          <div>
            <div className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
              Daily Free
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-foreground font-mono text-4xl font-extrabold">$0</span>
              <span className="text-muted-foreground font-mono text-xs">/ day</span>
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Instant, verified smartphone recommendations. No credit card or account needed to
              start.
            </p>

            <div className="border-border-hairline mt-6 border-t pt-6">
              <ul className="text-foreground space-y-2.5 font-mono text-xs">
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>2 queries every calendar day</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Resets at 00:00 UTC daily</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Multi-source grounded citations</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Anonymous device identity</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-border-hairline mt-8 border-t pt-6">
            <Link
              href="/recommend"
              className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground inline-flex w-full items-center justify-center border py-2.5 font-mono text-xs font-semibold tracking-wider uppercase transition-colors"
            >
              Start Searching Free
            </Link>
          </div>
        </div>

        {/* CREDIT PACKS */}
        <div className="bg-surface flex flex-col justify-between p-6 md:p-8">
          <div>
            <div className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
              Credit Packs
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-foreground font-mono text-4xl font-extrabold">$3 – $9</span>
              <span className="text-muted-foreground font-mono text-xs">one-time</span>
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Pay as you go when you need more than the daily free allowance. Credits never expire.
            </p>

            <div className="border-border-hairline mt-6 border-t pt-6">
              <ul className="text-foreground space-y-2.5 font-mono text-xs">
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Pack S: 25 queries ($0.12 / query)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Pack M: 100 queries ($0.09 / query)</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Zero expiration date</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Used only when daily free is spent</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-border-hairline mt-8 space-y-2 border-t pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground font-mono text-xs">25 Credits ($3)</div>
              <CheckoutButton productId="pack_s" label="Buy 25" variant="outline" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="text-muted-foreground font-mono text-xs">100 Credits ($9)</div>
              <CheckoutButton productId="pack_m" label="Buy 100" variant="outline" />
            </div>
          </div>
        </div>

        {/* PRO MONTHLY */}
        <div className="border-accent bg-surface relative flex flex-col justify-between border-2 p-6 md:p-8">
          <div className="bg-accent absolute -top-3 right-4 px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider text-black uppercase">
            Recommended
          </div>
          <div>
            <div className="text-accent font-mono text-xs font-semibold tracking-wider uppercase">
              Pro Monthly
            </div>
            <div className="mt-4 flex items-baseline gap-1">
              <span className="text-foreground font-mono text-4xl font-extrabold">$9.99</span>
              <span className="text-muted-foreground font-mono text-xs">/ month</span>
            </div>
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              Maximum intelligence and priority reasoning capacity for smartphone enthusiasts.
            </p>

            <div className="border-border-hairline mt-6 border-t pt-6">
              <ul className="text-foreground space-y-2.5 font-mono text-xs">
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>150 monthly included queries</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Deep reasoning analysis mode</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>2 concurrent queries</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Cross-device search history sync</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-accent select-none">✓</span>
                  <span>Self-service cancellation anytime</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="border-border-hairline mt-8 border-t pt-6">
            <CheckoutButton
              productId="pro_monthly"
              label="Upgrade to Pro"
              variant="solid"
              className="bg-accent hover:bg-accent-hover w-full text-black"
            />
          </div>
        </div>
      </div>

      {/* BYOK Callout Banner */}
      <div className="border-border-hairline bg-surface border p-6 md:flex md:items-center md:justify-between md:p-8">
        <div>
          <div className="text-accent font-mono text-xs font-bold tracking-wider uppercase">
            Developer / BYOK Friendly
          </div>
          <h3 className="text-foreground mt-1 text-base font-bold">
            Bring Your Own API Key (Zero Platform Charges)
          </h3>
          <p className="text-muted-foreground mt-1 max-w-2xl text-xs">
            Configure your personal keys from Google Gemini, Groq, NVIDIA, Cerebras, OpenAI, or
            OpenRouter. Keys stay strictly in your browser local storage.
          </p>
        </div>
        <div className="mt-4 md:mt-0">
          <Link
            href="/settings"
            className="border-border-hairline bg-surface-elevated text-foreground hover:border-foreground inline-flex items-center gap-2 border px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors"
          >
            <span>Configure BYOK</span>
            <span className="text-accent">→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}

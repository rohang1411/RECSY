'use client';

import { useState } from 'react';
import { BrutalistButton } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { QuotaPips, QuotaSegmentedRail } from '@/components/quota/QuotaPips';
import { ResetCountdown } from '@/components/quota/ResetCountdown';
import { PlanOption } from '@/components/quota/PlanOption';
import { QuotaSheet } from '@/components/quota/QuotaSheet';

const MOCK_RESET_ISO = '2026-10-22T06:42:00.000Z';

export default function UiLabPage() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetReason, setSheetReason] = useState<'free_exhausted' | 'sub_exhausted' | 'device_cap'>(
    'free_exhausted',
  );
  const [fieldVal, setFieldVal] = useState('user@example.com');
  const [fieldErr, setFieldErr] = useState('');

  return (
    <div className="bg-background text-foreground mx-auto min-h-screen max-w-5xl space-y-12 px-6 py-12">
      <div className="border-outline-variant border-b pb-6">
        <span className="meta-label text-accent font-mono text-xs tracking-widest uppercase">
          Internal Diagnostic
        </span>
        <h1 className="font-display mt-2 text-4xl font-extrabold uppercase">
          RECSY UI Component Lab
        </h1>
        <p className="text-muted-foreground mt-1 font-sans text-sm">
          Visual test harness for design tokens, zero-radius primitives, and quota states.
        </p>
      </div>

      {/* Buttons */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          1. Brutalist Buttons
        </h2>
        <div className="border-outline-variant bg-card flex flex-wrap items-center gap-4 border p-6">
          <BrutalistButton variant="outline">Outline (Default)</BrutalistButton>
          <BrutalistButton variant="solid">Solid Accent</BrutalistButton>
          <BrutalistButton variant="ghost">Ghost Meta</BrutalistButton>
          <BrutalistButton variant="danger">Danger Zone</BrutalistButton>
          <BrutalistButton variant="outline" size="lg">
            Size LG (Touch)
          </BrutalistButton>
          <BrutalistButton variant="outline" loading>
            Loading State
          </BrutalistButton>
        </div>
      </section>

      {/* Callouts */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          2. Technical Callouts
        </h2>
        <div className="space-y-3">
          <Callout variant="info" title="Informational">
            A query is one delivered recommendation or answer. Clarifying questions are free.
          </Callout>
          <Callout variant="warning" title="Capacity Alert">
            High demand right now. You weren&apos;t charged. Try again in 30s.
          </Callout>
          <Callout variant="error" title="Rate Limited">
            Too many attempts from this IP prefix. Please wait 10 seconds.
          </Callout>
          <Callout variant="success" title="Not Charged">
            Something went wrong on our side. Your credit was refunded automatically.
          </Callout>
        </div>
      </section>

      {/* Form Fields */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          3. Form Fields (Underline &amp; 16px Guard)
        </h2>
        <div className="border-outline-variant bg-card grid gap-6 border p-6 md:grid-cols-2">
          <Field
            label="Email Address"
            placeholder="name@example.com"
            value={fieldVal}
            onChange={(e) => {
              setFieldVal(e.target.value);
              if (fieldErr) setFieldErr('');
            }}
            hint="We'll send a 6-digit one-time code."
          />
          <Field
            label="With Error State"
            value="invalid-email"
            readOnly
            error="That doesn't look like an email address."
          />
          <Field label="Optional Note" optional placeholder="Preferences, budget, etc." />
          <Field label="Disabled Field" disabled value="Locked configuration" />
        </div>
      </section>

      {/* Quota Indicators */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          4. Quota HUD Indicators &amp; Pips
        </h2>
        <div className="border-outline-variant bg-card space-y-6 border p-6">
          <div className="space-y-2">
            <p className="meta-label text-muted-foreground text-xs">Free Allowance Pips</p>
            <div className="flex items-center gap-6">
              <div className="space-y-1">
                <span className="text-muted-foreground block font-mono text-[11px]">
                  2 of 2 Free:
                </span>
                <QuotaPips allowance={2} remaining={2} />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-mono text-[11px]">
                  1 of 2 Free:
                </span>
                <QuotaPips allowance={2} remaining={1} />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-mono text-[11px]">
                  0 of 2 (Exhausted):
                </span>
                <QuotaPips allowance={2} remaining={0} />
              </div>
              <div className="space-y-1">
                <span className="text-muted-foreground block font-mono text-[11px]">
                  Pulse Animation:
                </span>
                <QuotaPips allowance={2} remaining={1} flash="pulse" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <p className="meta-label text-muted-foreground text-xs">Pro Segmented Rail</p>
            <div className="flex items-center gap-4">
              <QuotaSegmentedRail total={150} used={38} />
              <span className="text-muted-foreground font-mono text-xs">38 of 150 used</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="meta-label text-muted-foreground text-xs">Shared 1Hz Reset Countdown</p>
            <ResetCountdown resetAt={MOCK_RESET_ISO} />
          </div>
        </div>
      </section>

      {/* Plan Option Mini-Cards */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          5. Plan Options &amp; Sheets
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <PlanOption
            title="25 Credits"
            badge="$0.12/q"
            price="$3"
            description="Never expire. Use for on-demand queries."
            action={<BrutalistButton className="w-full">BUY $3</BrutalistButton>}
          />
          <PlanOption
            title="100 Credits"
            badge="$0.09/q"
            price="$9"
            description="Best value per query."
            action={<BrutalistButton className="w-full">BUY $9</BrutalistButton>}
          />
          <PlanOption
            title="RECSY Pro"
            badge="150 Queries/mo"
            price="$9.99/mo"
            recommended
            description="Deep reasoning tier models, 2 concurrent queries, and saved history."
            action={
              <BrutalistButton variant="solid" className="w-full">
                UPGRADE
              </BrutalistButton>
            }
          />
        </div>

        <div className="flex gap-4 pt-4">
          <BrutalistButton
            variant="outline"
            onClick={() => {
              setSheetReason('free_exhausted');
              setIsSheetOpen(true);
            }}
          >
            Launch QuotaSheet (Free Exhausted)
          </BrutalistButton>
          <BrutalistButton
            variant="outline"
            onClick={() => {
              setSheetReason('sub_exhausted');
              setIsSheetOpen(true);
            }}
          >
            Launch QuotaSheet (Pro Exhausted)
          </BrutalistButton>
        </div>
      </section>

      {/* Skeletons */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          6. Skeletons (Zero Layout Shift)
        </h2>
        <div className="border-outline-variant bg-card space-y-3 border p-6">
          <Skeleton width={120} height={20} />
          <Skeleton width="100%" height={16} />
          <Skeleton width="75%" height={16} />
        </div>
      </section>

      <QuotaSheet isOpen={isSheetOpen} onClose={() => setIsSheetOpen(false)} reason={sheetReason} />
    </div>
  );
}

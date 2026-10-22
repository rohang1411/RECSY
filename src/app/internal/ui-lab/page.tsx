'use client';

import { useState } from 'react';
import { BrutalistButton } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Field } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { OtpInput } from '@/components/ui/otp-input';
import { Accordion, type AccordionItem } from '@/components/ui/accordion';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { QuotaPips, QuotaSegmentedRail } from '@/components/quota/QuotaPips';
import { ResetCountdown } from '@/components/quota/ResetCountdown';
import { PlanOption } from '@/components/quota/PlanOption';
import { QuotaSheet } from '@/components/quota/QuotaSheet';
import { GoogleButton } from '@/components/auth/GoogleButton';
import { TurnstileGate } from '@/components/auth/TurnstileGate';
import { AuthForm } from '@/components/auth/AuthForm';
import { openAuthSheet } from '@/components/auth/AuthSheet';
import { AccountMenu } from '@/components/auth/AccountMenu';
import { PricingGrid } from '@/components/billing/PricingGrid';
import { UsageStrip, type DayUsage } from '@/components/billing/UsageStrip';
import { LedgerTable, type LedgerEntryRecord } from '@/components/billing/LedgerTable';
import { ReturnStatus, type ReturnStatusType } from '@/components/billing/ReturnStatus';

const MOCK_RESET_ISO = '2026-10-22T06:42:00.000Z';

const MOCK_HEATMAP_DAYS: DayUsage[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  const charged = i % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0;
  const notCharged = i % 4 === 0 ? 1 : 0;
  return {
    date: d.toISOString().split('T')[0] ?? '2026-10-01',
    queries: charged + notCharged,
    charged,
    notCharged,
    total: charged + notCharged,
  };
});

const MOCK_LEDGER_ENTRIES: LedgerEntryRecord[] = [
  {
    id: 'l-1',
    createdAt: new Date().toISOString(),
    reason: 'Credit pack purchase (25 credits)',
    delta: 25,
    balanceAfter: 25,
  },
  {
    id: 'l-2',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    reason: 'Query usage charge (recommend)',
    delta: -1,
    balanceAfter: 24,
  },
  {
    id: 'l-3',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    reason: 'Promotional credit grant',
    delta: 5,
    balanceAfter: 29,
  },
];

const MOCK_ACCORDION_ITEMS: AccordionItem[] = [
  {
    id: 'item-1',
    title: 'What counts as a query?',
    content:
      'A query is one delivered recommendation or answer. Clarifying questions, empty results, errors and cancelled requests are free.',
  },
  {
    id: 'item-2',
    title: 'When do free queries reset?',
    content:
      'Free queries reset every night at 00:00 UTC (05:30 IST). Unused free queries do not roll over.',
  },
  {
    id: 'item-3',
    title: 'Do purchased credits expire?',
    content:
      'No. Query credits purchased in packs never expire and remain in your wallet until consumed.',
  },
];

interface SampleRow extends Record<string, unknown> {
  id: string;
  name: string;
  category: string;
  status: string;
}

const SAMPLE_COLUMNS: DataTableColumn<SampleRow>[] = [
  { key: 'name', header: 'Name', className: 'font-mono text-xs font-bold text-foreground' },
  { key: 'category', header: 'Category', className: 'font-mono text-xs text-muted-foreground' },
  {
    key: 'status',
    header: 'Status',
    align: 'right',
    className: 'font-mono text-xs text-accent uppercase',
  },
];

const SAMPLE_DATA: SampleRow[] = [
  { id: '1', name: 'Pixel 9 Pro', category: 'Compact Flagship', status: 'In Corpus' },
  { id: '2', name: 'Galaxy S24 Ultra', category: 'Powerhouse', status: 'In Corpus' },
  { id: '3', name: 'iPhone 16 Pro', category: 'iOS Flagship', status: 'In Corpus' },
];

export default function UiLabPage() {
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [sheetReason, setSheetReason] = useState<'free_exhausted' | 'sub_exhausted' | 'device_cap'>(
    'free_exhausted',
  );
  const [fieldVal, setFieldVal] = useState('user@example.com');
  const [fieldErr, setFieldErr] = useState('');
  const [otpVal, setOtpVal] = useState('');
  const [returnStatus, setReturnStatus] = useState<ReturnStatusType>('paid');

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
          Visual test harness for design tokens, zero-radius primitives, quota instruments, and
          account management surfaces.
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

      {/* Form Fields & OTP */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          3. Form Fields &amp; OTP Input
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

          <div className="space-y-2 md:col-span-2">
            <span className="text-muted-foreground block font-mono text-xs tracking-wider uppercase">
              6-Digit Numeric OTP Input (Auto-advance &amp; Paste)
            </span>
            <OtpInput
              value={otpVal}
              onChange={setOtpVal}
              onComplete={(code) => alert(`OTP Complete: ${code}`)}
            />
          </div>
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

      {/* Auth Components */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          5. Authentication Surfaces
        </h2>
        <div className="border-outline-variant bg-card space-y-6 border p-6">
          <div className="flex flex-wrap items-center gap-4">
            <GoogleButton />
            <AccountMenu signedIn={false} />
            <AccountMenu signedIn email="architect@recsy.dev" />
            <BrutalistButton variant="outline" onClick={() => openAuthSheet({ reason: 'header' })}>
              Open Global Auth Sheet
            </BrutalistButton>
          </div>

          <div className="border-outline-variant border-t pt-6">
            <h3 className="text-muted-foreground mb-4 font-mono text-xs uppercase">
              Inline Auth Form Preview
            </h3>
            <div className="border-outline-variant bg-surface max-w-md border p-6">
              <AuthForm reason="header" />
            </div>
          </div>

          <div className="border-outline-variant border-t pt-4">
            <TurnstileGate onSuccess={() => {}} />
          </div>
        </div>
      </section>

      {/* Pricing Grid */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          6. Pricing Grid (Hairline Structure)
        </h2>
        <PricingGrid />
      </section>

      {/* Usage Strip */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          7. 30-Day Activity Heat Strip
        </h2>
        <UsageStrip days={MOCK_HEATMAP_DAYS} />
      </section>

      {/* Financial Ledger */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          8. Credit Wallet Financial Ledger
        </h2>
        <LedgerTable entries={MOCK_LEDGER_ENTRIES} />
      </section>

      {/* Checkout Return Status */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
            9. Checkout Return Status
          </h2>
          <div className="flex gap-2">
            {(['paid', 'processing', 'failed', 'canceled', 'pro_active'] as ReturnStatusType[]).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setReturnStatus(st)}
                  className={`border px-2 py-1 font-mono text-[10px] uppercase ${
                    returnStatus === st
                      ? 'border-accent bg-accent font-bold text-black'
                      : 'border-outline-variant bg-surface text-muted-foreground'
                  }`}
                >
                  {st}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="border-outline-variant bg-surface border p-4">
          <ReturnStatus initialStatus={returnStatus} creditsAdded={25} />
        </div>
      </section>

      {/* Accordion & DataTable */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          10. WAI-ARIA Technical Accordion &amp; Responsive Data Table
        </h2>
        <div className="space-y-6">
          <Accordion items={MOCK_ACCORDION_ITEMS} />
          <DataTable
            columns={SAMPLE_COLUMNS}
            data={SAMPLE_DATA}
            caption="Sample Phone Corpus Table"
          />
        </div>
      </section>

      {/* Plan Option Mini-Cards */}
      <section className="space-y-4">
        <h2 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
          11. Plan Options &amp; Quota Sheets
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
          12. Skeletons (Zero Layout Shift)
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

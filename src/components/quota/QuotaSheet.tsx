'use client';

import { useSyncExternalStore } from 'react';
import { Sheet } from '@/components/ui/sheet';
import { BrutalistButton, BrutalistLinkButton } from '@/components/ui/button';
import { ResetCountdown } from './ResetCountdown';
import { PlanOption } from './PlanOption';
import { quotaStore } from './quota-store';
import { formatLocalTime } from './clock-store';
import { COPY } from '@/content/copy';

const FALLBACK_RESET_AT = '2026-10-22T00:00:00.000Z';

export interface QuotaSheetProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly reason?: 'free_exhausted' | 'sub_exhausted' | 'device_cap';
  readonly onSelectProduct?: (code: 'pack_s' | 'pack_m' | 'pro_monthly') => void;
  readonly isCheckoutLoading?: boolean;
}

export function QuotaSheet({
  isOpen,
  onClose,
  reason = 'free_exhausted',
  onSelectProduct,
  isCheckoutLoading = false,
}: QuotaSheetProps) {
  const quota = useSyncExternalStore(
    quotaStore.subscribe,
    quotaStore.getSnapshot,
    quotaStore.getServerSnapshot,
  );

  const snapshot = quota.snapshot;
  const resetAt = snapshot?.resetAt ?? FALLBACK_RESET_AT;
  const resetLocalTime = formatLocalTime(resetAt);

  const title =
    reason === 'sub_exhausted'
      ? 'PRO ALLOWANCE USED'
      : reason === 'device_cap'
        ? 'DEVICE LIMIT REACHED'
        : 'OUT OF FREE QUERIES';

  return (
    <Sheet isOpen={isOpen} onClose={onClose} title={title}>
      <div className="flex flex-col gap-6">
        {/* Reset Countdown Block */}
        <div className="border-outline-variant bg-surface-container-low border p-4 text-center">
          <p className="meta-label text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
            Next reset in
          </p>
          <div className="text-primary mt-1 font-mono text-2xl font-bold tracking-tight">
            <ResetCountdown resetAt={resetAt} showLocalTime={false} />
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            RESETS 00:00 UTC · {resetLocalTime}
          </p>
        </div>

        {/* 1. Wait for reset note */}
        <div className="text-muted-foreground border-outline border-l-2 pl-3 font-mono text-xs leading-relaxed">
          {COPY.deny.freeBody(snapshot?.free.allowance ?? 2, resetLocalTime)}
        </div>

        <div className="space-y-3">
          <p className="meta-label text-primary font-mono text-[11px] tracking-[0.18em] uppercase">
            Keep Going Now
          </p>

          {/* 2. Credits Mini-Cards */}
          <div className="grid grid-cols-2 gap-3">
            <PlanOption
              title="25 Credits"
              badge="$0.12/q"
              price="$3"
              description="Never expire."
              action={
                <BrutalistButton
                  size="md"
                  variant="outline"
                  loading={isCheckoutLoading}
                  onClick={() => onSelectProduct?.('pack_s')}
                  className="w-full"
                >
                  BUY $3
                </BrutalistButton>
              }
            />
            <PlanOption
              title="100 Credits"
              badge="$0.09/q"
              price="$9"
              description="Best value per query."
              action={
                <BrutalistButton
                  size="md"
                  variant="outline"
                  loading={isCheckoutLoading}
                  onClick={() => onSelectProduct?.('pack_m')}
                  className="w-full"
                >
                  BUY $9
                </BrutalistButton>
              }
            />
          </div>

          {/* 3. Pro Subscription Card */}
          <PlanOption
            title="RECSY Pro"
            badge="150 Queries/mo"
            price="$9.99/mo"
            recommended={true}
            description="Deep reasoning tier models, 2 concurrent queries, and saved history across devices."
            action={
              <BrutalistButton
                size="md"
                variant="solid"
                loading={isCheckoutLoading}
                onClick={() => onSelectProduct?.('pro_monthly')}
                className="w-full"
              >
                UPGRADE TO PRO
              </BrutalistButton>
            }
          />

          {/* 4. BYOK option */}
          <div className="border-outline-variant bg-surface-container-lowest flex items-center justify-between gap-4 border p-3">
            <div className="space-y-0.5">
              <span className="text-primary font-mono text-xs font-bold tracking-wider uppercase">
                Bring Your Own Key
              </span>
              <p className="text-muted-foreground text-xs">
                Run queries with your Gemini, Groq, or OpenAI key. Free of RECSY charges, up to
                100/day.
              </p>
            </div>
            <BrutalistLinkButton
              href="/settings"
              size="md"
              variant="outline"
              className="shrink-0"
              onClick={onClose}
            >
              SETTINGS
            </BrutalistLinkButton>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

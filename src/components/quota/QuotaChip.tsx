'use client';

import { useSyncExternalStore } from 'react';
import { quotaStore } from './quota-store';
import { QuotaPips } from './QuotaPips';
import { Skeleton } from '@/components/ui/skeleton';
import { hasClientByokKey } from '@/lib/byok-client';
import { cn } from '@/lib/utils';

export interface QuotaChipProps {
  readonly onOpenDetails?: () => void;
  readonly className?: string;
}

export function QuotaChip({ onOpenDetails, className }: QuotaChipProps) {
  const quota = useSyncExternalStore(
    quotaStore.subscribe,
    quotaStore.getSnapshot,
    quotaStore.getServerSnapshot,
  );

  // If loading and no cached snapshot exists
  if (quota.loading && !quota.snapshot) {
    return <Skeleton width={76} height={26} className={className} />;
  }

  const snapshot = quota.snapshot;
  if (!snapshot) return null;

  // Plan 25 invariant: If mode is 'off' or 'shadow', users must not see a meter that is not enforced
  if (snapshot.mode === 'off' || snapshot.mode === 'shadow') {
    return null;
  }

  // Check BYOK
  const isByok = hasClientByokKey() && snapshot.byok.active;
  if (isByok) {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className={cn(
          'border-outline inline-flex items-center gap-1.5 border bg-transparent px-2.5 py-1',
          'text-muted-foreground font-mono text-[10px] tracking-wider uppercase transition-colors',
          'hover:border-accent hover:text-primary focus-visible:ring-primary focus-visible:ring-1 focus-visible:outline-none',
          className,
        )}
      >
        <span className="text-primary font-bold">KEY</span>
        <span className="tabular-nums">
          {snapshot.byok.usedToday}/{snapshot.byok.dailyCap}
        </span>
      </button>
    );
  }

  // Check Platform Capacity
  if (snapshot.capacity === 'paused') {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className={cn(
          'border-destructive/60 bg-destructive/10 inline-flex items-center gap-1.5 border px-2.5 py-1',
          'text-destructive font-mono text-[10px] tracking-wider uppercase transition-colors',
          className,
        )}
      >
        PAUSED
      </button>
    );
  }

  if (snapshot.capacity === 'busy') {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className={cn(
          'border-warning/60 bg-warning/10 inline-flex items-center gap-1.5 border px-2.5 py-1',
          'text-warning font-mono text-[10px] tracking-wider uppercase transition-colors',
          className,
        )}
      >
        BUSY
      </button>
    );
  }

  // Check Subscription
  if (snapshot.subscription && snapshot.subscription.status === 'past_due') {
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className={cn(
          'border-warning/60 bg-warning/10 inline-flex items-center gap-1.5 border px-2.5 py-1',
          'text-warning font-mono text-[10px] tracking-wider uppercase transition-colors',
          className,
        )}
      >
        PRO ISSUE
      </button>
    );
  }

  if (
    snapshot.subscription &&
    (snapshot.subscription.status === 'active' || snapshot.subscription.status === 'trialing')
  ) {
    const remaining = Math.max(
      0,
      snapshot.subscription.includedQueries - snapshot.subscription.usedThisPeriod,
    );
    return (
      <button
        type="button"
        onClick={onOpenDetails}
        className={cn(
          'border-outline inline-flex items-center gap-1.5 border bg-transparent px-2.5 py-1',
          'text-primary font-mono text-[10px] tracking-wider uppercase transition-colors',
          'hover:border-accent focus-visible:ring-primary focus-visible:ring-1 focus-visible:outline-none',
          className,
        )}
      >
        <span className="text-accent font-bold">PRO</span>
        <span className="font-bold tabular-nums">{remaining}</span>
      </button>
    );
  }

  // Free or Credits
  const freeLeft = snapshot.free.remaining;
  const isExhausted = freeLeft === 0 && snapshot.credits === 0;

  return (
    <button
      type="button"
      onClick={onOpenDetails}
      className={cn(
        'inline-flex items-center gap-2 border px-2.5 py-1 transition-colors select-none',
        'font-mono text-[10px] tracking-wider uppercase',
        isExhausted
          ? 'border-accent text-accent'
          : 'border-outline text-primary hover:border-accent',
        'focus-visible:ring-primary focus-visible:ring-1 focus-visible:outline-none',
        className,
      )}
    >
      <QuotaPips
        allowance={snapshot.free.allowance}
        remaining={snapshot.free.remaining}
        flash={quota.pipFlash}
      />

      {/* Text label: hidden on screen widths <= 380px per section 12.4 */}
      <span className="hidden font-bold tabular-nums min-[380px]:inline">
        {freeLeft > 0
          ? snapshot.signedIn
            ? `${freeLeft} LEFT`
            : `${freeLeft} FREE`
          : snapshot.credits > 0
            ? `CR ${snapshot.credits}`
            : snapshot.signedIn
              ? '0'
              : '0 FREE'}
      </span>
    </button>
  );
}

'use client';

import { useSyncExternalStore } from 'react';
import { quotaStore } from './quota-store';
import { QuotaPips, QuotaSegmentedRail } from './QuotaPips';
import { ResetCountdown } from './ResetCountdown';
import { Skeleton } from '@/components/ui/skeleton';
import { COPY } from '@/content/copy';
import { hasClientByokKey } from '@/lib/byok-client';
import { cn } from '@/lib/utils';

export interface QuotaMeterProps {
  readonly className?: string;
  readonly onOpenOptions?: () => void;
  readonly compact?: boolean;
}

export function QuotaMeter({ className, onOpenOptions, compact = false }: QuotaMeterProps) {
  const quota = useSyncExternalStore(
    quotaStore.subscribe,
    quotaStore.getSnapshot,
    quotaStore.getServerSnapshot,
  );

  if (quota.loading && !quota.snapshot) {
    if (compact) {
      return <Skeleton width={110} height={20} className={className} />;
    }
    return (
      <div className={cn('flex items-center gap-3 py-2', className)}>
        <Skeleton width={80} height={14} />
        <Skeleton width={180} height={14} />
      </div>
    );
  }

  const snapshot = quota.snapshot;
  if (!snapshot) return null;

  // Invariant: Do not render when quota is off or shadow
  if (snapshot.mode === 'off' || snapshot.mode === 'shadow') {
    return null;
  }

  // Check BYOK
  const isByok = hasClientByokKey() && snapshot.byok.active;
  if (isByok) {
    if (compact) {
      return (
        <div className={cn('inline-flex items-center gap-1.5 font-mono text-xs', className)}>
          <span className="text-primary font-bold">[KEY]</span>
          <span className="text-muted-foreground text-[11px] tabular-nums">
            {snapshot.byok.usedToday}/{snapshot.byok.dailyCap}
          </span>
        </div>
      );
    }
    return (
      <div
        className={cn(
          'text-muted-foreground flex flex-wrap items-center gap-2 py-2 font-mono text-xs',
          className,
        )}
      >
        <span className="text-primary font-bold">[BYOK]</span>
        <span>{COPY.hud.byokActive(snapshot.byok.usedToday, snapshot.byok.dailyCap)}</span>
      </div>
    );
  }

  // Check Subscription
  if (
    snapshot.subscription &&
    (snapshot.subscription.status === 'active' || snapshot.subscription.status === 'trialing')
  ) {
    const sub = snapshot.subscription;
    const remaining = Math.max(0, sub.includedQueries - sub.usedThisPeriod);
    const renewsDate = new Date(sub.periodEnd).toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'short',
    });

    if (compact) {
      return (
        <div className={cn('inline-flex items-center gap-2 font-mono text-xs', className)}>
          <span className="text-accent font-bold">PRO</span>
          <span className="text-foreground text-[11px] tabular-nums">{remaining} left</span>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 py-2 font-mono text-xs',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-accent font-bold">PRO</span>
          <QuotaSegmentedRail total={sub.includedQueries} used={sub.usedThisPeriod} />
          <span className="text-muted-foreground">
            {COPY.hud.proActive(remaining, sub.includedQueries, renewsDate)}
          </span>
        </div>
      </div>
    );
  }

  // Free or Credits
  const free = snapshot.free;
  const isExhausted = free.remaining === 0 && snapshot.credits === 0;

  if (compact) {
    return (
      <div
        className={cn('inline-flex items-center gap-2 font-mono text-xs select-none', className)}
      >
        <QuotaPips allowance={free.allowance} remaining={free.remaining} flash={quota.pipFlash} />
        <span
          className={cn(
            isExhausted ? 'text-accent font-semibold' : 'text-muted-foreground',
            'text-[11px] tabular-nums',
          )}
        >
          {free.remaining > 0
            ? `${free.remaining}/${free.allowance} free`
            : snapshot.credits > 0
              ? `${snapshot.credits} credits`
              : '0 free left'}
        </span>
        {onOpenOptions ? (
          <button
            type="button"
            onClick={onOpenOptions}
            className={cn(
              'border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase transition-colors',
              isExhausted
                ? 'border-accent bg-accent/15 text-accent hover:bg-accent animate-pulse font-bold hover:text-black'
                : 'border-outline-variant text-primary/80 hover:border-primary hover:text-accent',
            )}
          >
            {isExhausted ? 'Buy Credits ↗' : '+ Top Up'}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 py-1 font-mono text-xs select-none',
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        <QuotaPips allowance={free.allowance} remaining={free.remaining} flash={quota.pipFlash} />

        <span className="text-muted-foreground">
          {!snapshot.signedIn ? (
            free.remaining > 0 ? (
              COPY.hud.anonReady(free.remaining)
            ) : (
              <span className="text-accent font-semibold">{COPY.hud.anonExhausted}</span>
            )
          ) : free.remaining > 0 ? (
            COPY.hud.freeReady(free.remaining, free.allowance)
          ) : snapshot.credits > 0 ? (
            COPY.hud.nextCredit + ` · ${snapshot.credits} left`
          ) : (
            <span className="text-accent font-semibold">
              Free queries used (0/{free.allowance})
            </span>
          )}
        </span>

        {onOpenOptions && (
          <button
            type="button"
            onClick={onOpenOptions}
            className={cn(
              'border px-2 py-0.5 font-mono text-[11px] tracking-wider uppercase transition-colors',
              isExhausted
                ? 'border-accent bg-accent/15 text-accent hover:bg-accent font-bold hover:text-black'
                : 'border-outline-variant text-primary hover:border-primary hover:text-accent font-semibold',
            )}
          >
            {isExhausted ? '[Buy Credits / Upgrade ↗]' : '[Get more]'}
          </button>
        )}
      </div>

      {snapshot.resetAt && (
        <div className="text-muted-foreground hidden items-center gap-1.5 text-[11px] sm:flex">
          <span>resets in</span>
          <ResetCountdown resetAt={snapshot.resetAt} showLocalTime={false} />
        </div>
      )}
    </div>
  );
}

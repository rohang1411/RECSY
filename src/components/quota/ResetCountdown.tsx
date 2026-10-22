'use client';

import { useSyncExternalStore } from 'react';
import { clockStore, formatCountdown, formatLocalTime } from './clock-store';
import { cn } from '@/lib/utils';

export interface ResetCountdownProps {
  readonly resetAt: string;
  readonly showLocalTime?: boolean;
  readonly className?: string;
}

export function ResetCountdown({ resetAt, showLocalTime = true, className }: ResetCountdownProps) {
  const now = useSyncExternalStore(
    clockStore.subscribe,
    clockStore.getSnapshot,
    clockStore.getServerSnapshot,
  );

  const countdown = formatCountdown(resetAt, now);
  const localTime = showLocalTime ? formatLocalTime(resetAt) : null;

  return (
    <span
      className={cn('inline-flex items-baseline gap-1.5 font-mono text-xs tabular-nums', className)}
      title={`Resets in ${countdown} (${localTime ?? ''})`}
    >
      <span aria-hidden="true" className="text-primary font-bold">
        {countdown}
      </span>
      {localTime && (
        <span className="text-muted-foreground text-[11px] tracking-wider uppercase">
          ({localTime})
        </span>
      )}
    </span>
  );
}

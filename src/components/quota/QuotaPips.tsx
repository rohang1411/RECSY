'use client';

import { cn } from '@/lib/utils';

export interface QuotaPipsProps {
  readonly allowance: number;
  readonly remaining: number;
  readonly flash?: 'pulse' | 'spent' | 'restored' | null;
  readonly className?: string;
}

export function QuotaPips({ allowance, remaining, flash, className }: QuotaPipsProps) {
  const safeAllowance = Math.max(0, allowance);
  const safeRemaining = Math.max(0, Math.min(safeAllowance, remaining));

  if (safeAllowance > 6) {
    return (
      <span
        aria-hidden="true"
        className={cn('text-primary font-mono text-xs font-bold tabular-nums', className)}
      >
        {safeRemaining}/{safeAllowance}
      </span>
    );
  }

  const pips = Array.from({ length: safeAllowance }, (_, i) => {
    // Left-to-right filling: index < remaining is filled
    const isFilled = i < safeRemaining;
    const isTargetPip = i === safeRemaining - 1;

    return (
      <span
        key={i}
        aria-hidden="true"
        className={cn(
          'border-outline inline-block h-[10px] w-[10px] rounded-none border transition-colors duration-200',
          isFilled ? 'bg-primary' : 'bg-transparent',
          isTargetPip && flash === 'pulse' && 'border-accent animate-pulse',
          isTargetPip &&
            flash === 'spent' &&
            'border-accent bg-transparent transition-all duration-260',
          isTargetPip &&
            flash === 'restored' &&
            'border-success bg-primary transition-all duration-260',
        )}
      />
    );
  });

  return (
    <div
      aria-hidden="true"
      className={cn('inline-flex items-center gap-1.5 select-none', className)}
    >
      {pips}
    </div>
  );
}

export function QuotaSegmentedRail({
  total,
  used,
  className,
}: {
  readonly total: number;
  readonly used: number;
  readonly className?: string;
}) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'bg-surface-container-high h-[2px] w-16 overflow-hidden select-none',
        className,
      )}
    >
      <div
        className="bg-accent h-full transition-all duration-300"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type CalloutVariant = 'info' | 'warning' | 'error' | 'success';

export interface CalloutProps {
  readonly variant?: CalloutVariant;
  readonly title?: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly className?: string;
}

const variantStyles: Record<
  CalloutVariant,
  { borderLeft: string; bg: string; titleColor: string }
> = {
  info: {
    borderLeft: 'border-l-accent',
    bg: 'bg-card',
    titleColor: 'text-accent',
  },
  warning: {
    borderLeft: 'border-l-warning',
    bg: 'bg-warning/5',
    titleColor: 'text-warning',
  },
  error: {
    borderLeft: 'border-l-destructive',
    bg: 'bg-destructive/5',
    titleColor: 'text-destructive',
  },
  success: {
    borderLeft: 'border-l-success',
    bg: 'bg-success/5',
    titleColor: 'text-success',
  },
};

export function Callout({ variant = 'info', title, children, action, className }: CalloutProps) {
  const styles = variantStyles[variant];

  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={cn(
        'border-outline-variant w-full rounded-none border border-l-4 p-4 transition-colors duration-150',
        styles.borderLeft,
        styles.bg,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-1">
          {title && (
            <p
              className={cn(
                'meta-label font-mono text-[11px] tracking-[0.18em] uppercase',
                styles.titleColor,
              )}
            >
              {title}
            </p>
          )}
          <div className="text-foreground/90 font-sans text-xs leading-relaxed md:text-sm">
            {children}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
    </div>
  );
}

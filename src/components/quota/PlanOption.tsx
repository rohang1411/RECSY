import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PlanOptionProps {
  readonly title: string;
  readonly badge?: string;
  readonly description: string;
  readonly price?: string;
  readonly action?: ReactNode;
  readonly recommended?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
}

export function PlanOption({
  title,
  badge,
  description,
  price,
  action,
  recommended = false,
  onClick,
  className,
}: PlanOptionProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group bg-card relative flex flex-col justify-between border p-4 transition-colors duration-150',
        recommended ? 'border-accent' : 'border-outline-variant hover:border-outline',
        onClick ? 'cursor-pointer' : '',
        className,
      )}
    >
      {recommended && (
        <span className="bg-accent text-background absolute -top-2.5 right-4 px-2 py-0.5 font-mono text-[9px] font-bold tracking-wider uppercase">
          Recommended
        </span>
      )}

      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h4 className="text-primary font-mono text-sm font-bold tracking-wider uppercase">
              {title}
            </h4>
            {badge && (
              <span className="text-muted-foreground border-outline-variant border px-1.5 py-0.5 font-mono text-[10px] tracking-wider uppercase">
                {badge}
              </span>
            )}
          </div>
          {price && (
            <span className="text-primary font-mono text-sm font-bold tabular-nums">{price}</span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 font-sans text-xs leading-relaxed">
          {description}
        </p>
      </div>

      {action && <div className="border-outline-variant/60 mt-4 border-t pt-3">{action}</div>}
    </div>
  );
}

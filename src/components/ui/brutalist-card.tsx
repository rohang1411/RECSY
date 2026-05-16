import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export function BrutalistCard({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('brutalist-border brutalist-hover bg-card text-card-foreground', className)}
      {...props}
    />
  );
}

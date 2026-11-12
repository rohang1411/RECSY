import { cn } from '@/lib/utils';

export interface SkeletonProps {
  readonly className?: string;
  readonly width?: string | number;
  readonly height?: string | number;
}

export function Skeleton({ className, width, height }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
      className={cn(
        'bg-surface-container-low border-outline-variant/60 relative overflow-hidden rounded-none border',
        'before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite]',
        'before:bg-gradient-to-r before:from-transparent before:via-white/5 before:to-transparent',
        className,
      )}
    />
  );
}

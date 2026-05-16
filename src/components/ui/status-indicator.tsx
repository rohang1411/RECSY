import { cn } from '@/lib/utils';

export function StatusIndicator({ className }: { readonly className?: string }) {
  return <span aria-hidden className={cn('bg-primary block size-1.5 animate-pulse', className)} />;
}

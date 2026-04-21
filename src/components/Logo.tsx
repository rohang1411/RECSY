import { cn } from '@/lib/utils';

/**
 * RECSY wordmark with a subtle orange-to-cyan gradient. Purely decorative —
 * the semantic name lives in the surrounding link's aria-label.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'bg-gradient-to-r from-[color:var(--primary)] to-[color:var(--accent)] bg-clip-text text-lg font-semibold tracking-tight text-transparent',
        className,
      )}
    >
      RECSY
    </span>
  );
}

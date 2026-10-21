'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

interface InternalRefreshButtonProps {
  readonly label?: string;
  readonly refreshParam?: string;
  readonly className?: string;
}

export function InternalRefreshButton({
  label = 'Refresh',
  refreshParam = 'refresh',
  className = 'border-outline text-primary hover:border-accent hover:text-accent border px-3 py-1.5 font-mono text-[11px] tracking-[0.14em] uppercase transition-colors inline-flex items-center gap-1.5 cursor-pointer',
}: InternalRefreshButtonProps) {
  let router: ReturnType<typeof useRouter> | null = null;
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    router = useRouter();
  } catch {
    router = null;
  }
  const [isPending, startTransition] = useTransition();

  const handleRefresh = () => {
    startTransition(() => {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set(refreshParam, String(Date.now()));
        if (router) {
          router.replace(url.pathname + url.search);
          router.refresh();
        } else {
          window.location.href = url.pathname + url.search;
        }
      }
    });
  };

  return (
    <button type="button" onClick={handleRefresh} disabled={isPending} className={className}>
      <RefreshCw className={`size-3 ${isPending ? 'animate-spin' : ''}`} aria-hidden />
      <span>{isPending ? 'Refreshing...' : label}</span>
    </button>
  );
}

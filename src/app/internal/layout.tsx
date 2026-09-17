import { notFound } from 'next/navigation';

import { InternalMobileHeader, InternalNav } from '@/app/internal/_components/internal-nav';
import { env } from '@/env';

export const dynamic = 'force-dynamic';

export default function InternalLayout({ children }: { readonly children: React.ReactNode }) {
  if (env.NODE_ENV === 'production' && !env.INTERNAL_DASHBOARD_ENABLED) {
    notFound();
  }

  return (
    <div
      data-internal-dashboard="true"
      className="bg-background text-foreground flex min-h-dvh flex-col lg:flex-row"
    >
      <InternalNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <InternalMobileHeader />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

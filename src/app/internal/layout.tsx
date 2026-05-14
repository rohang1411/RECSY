import { notFound } from 'next/navigation';

import { env } from '@/env';

export const dynamic = 'force-dynamic';

export default function InternalLayout({ children }: { readonly children: React.ReactNode }) {
  if (!env.INTERNAL_DASHBOARD_ENABLED) {
    notFound();
  }

  return (
    <div
      data-internal-dashboard="true"
      className="bg-background text-foreground min-h-dvh overflow-hidden"
    >
      {children}
    </div>
  );
}

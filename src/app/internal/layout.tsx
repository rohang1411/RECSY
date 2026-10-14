import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { InternalMobileHeader, InternalNav } from '@/app/internal/_components/internal-nav';
import { env } from '@/env';
import { isOperatorAuthorized } from '@/services/internal/auth';
import OperatorLoginPage from '@/app/internal/login/page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function InternalLayout({ children }: { readonly children: React.ReactNode }) {
  if (!env.INTERNAL_DASHBOARD_ENABLED) {
    notFound();
  }

  const authorized = await isOperatorAuthorized();
  if (!authorized) {
    return <OperatorLoginPage />;
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

import type { Metadata } from 'next';
import React from 'react';
import { AccountNav } from './AccountNav';

export const metadata: Metadata = {
  title: 'Account',
  description: 'Manage your RECSY account, quotas, billing, and privacy.',
  robots: {
    index: false,
    follow: false,
  },
};

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Account Page Header */}
      <div className="border-border-hairline bg-surface border-b py-8 md:py-10">
        <div className="mx-auto max-w-7xl px-4 md:px-6">
          <div className="text-accent font-mono text-[11px] font-bold tracking-widest uppercase">
            User Workspace
          </div>
          <h1 className="text-foreground mt-2 text-2xl font-extrabold tracking-tight md:text-4xl">
            ACCOUNT DASHBOARD
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            Quotas, billing subscriptions, query activity, and data privacy.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          {/* Navigation Rail */}
          <aside className="lg:col-span-3">
            <AccountNav />
          </aside>

          {/* Content Area */}
          <main className="min-w-0 lg:col-span-9">{children}</main>
        </div>
      </div>
    </div>
  );
}

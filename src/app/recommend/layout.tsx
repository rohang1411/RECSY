import type { Metadata } from 'next';
import React from 'react';
import { SideNav } from '@/components/ui/side-nav';
import { RecommendQueryProvider } from '@/lib/recommend-sessions/query-client';
import { HistoryPanel, RecommendHeaderActions } from '@/components/recommend/history';

export const metadata: Metadata = {
  title: 'Recommend | RECSY',
  description: 'AI-assisted conversational smartphone recommendations.',
};

export default function RecommendLayout({ children }: { children: React.ReactNode }) {
  return (
    <RecommendQueryProvider>
      <div className="bg-background flex min-h-screen">
        <SideNav active="/recommend">
          <HistoryPanel />
        </SideNav>
        <div className="grid-bg min-w-0 flex-1">
          <header className="border-outline-variant px-grid-margin border-b py-10 sm:py-14">
            <div className="flex items-center justify-between gap-4">
              <p className="meta-label border-primary border-l-2 pl-4">Recommend</p>
              <RecommendHeaderActions />
            </div>
            <h1 className="heading-scanline text-gradient-accent-edge font-display mt-5 text-4xl leading-none font-extrabold tracking-normal break-words uppercase sm:text-7xl lg:text-8xl">
              Recommend
            </h1>
            <p className="text-muted-foreground mt-6 max-w-2xl text-sm leading-6">
              Just describe the phone you want, the features you care about, and any price
              preference. RECSY will turn that into a ranked shortlist.
            </p>
          </header>
          {children}
        </div>
      </div>
    </RecommendQueryProvider>
  );
}

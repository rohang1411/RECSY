import { SideNav } from '@/components/ui/side-nav';
import { getActiveRegion } from '@/lib/get-active-region';

import { RecommendClient } from '../recommend-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ sessionId: string }>;
}

export default async function RecommendSessionPage({ params }: PageProps) {
  const { sessionId } = await params;
  const activeRegion = await getActiveRegion();

  return (
    <div className="bg-background flex min-h-dvh">
      <SideNav active="/recommend" />
      <div className="grid-bg flex min-w-0 flex-1 flex-col">
        <header className="border-outline-variant px-grid-margin border-b py-8 sm:py-10">
          <p className="meta-label border-primary mb-3 border-l-2 pl-4">Recommendation Workspace</p>
          <h1 className="heading-scanline text-gradient-accent-edge font-display text-3xl leading-none font-extrabold tracking-normal break-words uppercase sm:text-5xl lg:text-6xl">
            Recommend
          </h1>
        </header>
        <RecommendClient activeRegion={activeRegion} initialSessionId={sessionId} />
      </div>
    </div>
  );
}

import { redirect } from 'next/navigation';
import { getActiveRegion } from '@/lib/get-active-region';
import { RecommendClient } from './recommend-client';

export const dynamic = 'force-dynamic';

interface RecommendPageProps {
  searchParams: Promise<{ session?: string }>;
}

export default async function RecommendPage({ searchParams }: RecommendPageProps) {
  const { session } = await searchParams;
  if (session && typeof session === 'string') {
    redirect(`/recommend/${encodeURIComponent(session)}`);
  }

  const activeRegion = await getActiveRegion();

  return <RecommendClient activeRegion={activeRegion} />;
}

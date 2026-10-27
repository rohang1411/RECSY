import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextRequest } from 'next/server';
import { z } from 'zod';

import { getActiveRegion } from '@/lib/get-active-region';
import { resolveRequestIdentity } from '@/services/auth/identity';
import { getDb } from '@/services/db/client';
import { getSessionDetail, ownerFromIdentity } from '@/services/recommender/sessions';
import { RecommendClient } from '../recommend-client';

export const dynamic = 'force-dynamic';

interface SessionPageProps {
  params: Promise<{ id: string }>;
}

const idSchema = z.string().uuid();

export default async function SessionPage({ params }: SessionPageProps) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    notFound();
  }

  const headerList = await headers();
  const req = new NextRequest(`http://localhost/recommend/${encodeURIComponent(id)}`, {
    headers: headerList,
  });

  const identity = await resolveRequestIdentity(req);
  const owner = ownerFromIdentity(identity);

  const session = await getSessionDetail(getDb(), id, owner);
  if (!session || session.status === 'deleted') {
    notFound();
  }

  const activeRegion = await getActiveRegion();

  return <RecommendClient sessionId={id} initialSession={session} activeRegion={activeRegion} />;
}

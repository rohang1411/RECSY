import { NextResponse } from 'next/server';
import { getCatalog } from '@/services/billing/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const products = getCatalog();

  return NextResponse.json(
    { products },
    {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=600, stale-while-revalidate=1200',
      },
    },
  );
}

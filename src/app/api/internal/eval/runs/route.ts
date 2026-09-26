/**
 * GET /api/internal/eval/runs — List historical benchmark runs.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/services/db/client';
import { listBenchmarkRuns } from '@/services/eval/storage/benchmark-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const db = getDb();
    const runs = await listBenchmarkRuns(db, 30);
    return NextResponse.json({ runs });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

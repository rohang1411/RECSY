/**
 * GET /api/internal/eval/runs — List historical benchmark runs.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/services/db/client';
import { listBenchmarkRuns } from '@/services/eval/storage/benchmark-repository';
import { evalAccessError } from '@/services/eval/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;
  try {
    const db = getDb();
    const runs = await listBenchmarkRuns(db, 30);
    return NextResponse.json({ runs });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

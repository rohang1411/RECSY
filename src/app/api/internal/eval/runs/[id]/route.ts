/**
 * GET /api/internal/eval/runs/[id] — Fetch granular details and trace results.
 * DELETE /api/internal/eval/runs/[id] — Delete benchmark run.
 */
import { NextResponse } from 'next/server';
import { getDb } from '@/services/db/client';
import {
  getBenchmarkRunById,
  deleteBenchmarkRun,
} from '@/services/eval/storage/benchmark-repository';
import { evalAccessError } from '@/services/eval/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const db = getDb();
    const run = await getBenchmarkRunById(db, id);

    if (!run) {
      return NextResponse.json({ error: 'Benchmark run not found' }, { status: 404 });
    }

    return NextResponse.json({ run });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;
  try {
    const { id } = await context.params;
    const db = getDb();
    await deleteBenchmarkRun(db, id);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

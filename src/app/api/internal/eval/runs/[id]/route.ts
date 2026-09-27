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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
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

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
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

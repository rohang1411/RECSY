import { z } from 'zod';
import { getDb } from '@/services/db/client';
import { checkEvaluationReadiness } from '@/services/eval/preflight';
import { evalAccessError } from '@/services/eval/access';
import { diagnoseEvaluationError } from '@/services/eval/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const querySchema = z.object({
  suite: z.enum(['recsys', 'rag', 'load-stress', 'multi-turn', 'all']).default('recsys'),
  sampleScale: z.enum(['quick', 'full']).default('full'),
});

export async function GET(request: Request): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;
  try {
    const url = new URL(request.url);
    const query = querySchema.parse(Object.fromEntries(url.searchParams));
    const report = await checkEvaluationReadiness(getDb(), query.suite, query.sampleScale);
    return Response.json({ ready: true, report });
  } catch (error) {
    return Response.json({ ready: false, error: diagnoseEvaluationError(error) }, { status: 422 });
  }
}

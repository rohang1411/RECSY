import { z } from 'zod';
import { evalAccessError } from '@/services/eval/access';
import { diagnoseEvaluationError } from '@/services/eval/errors';
import {
  runAblationComparison,
  listAvailableAblations,
  type AblationType,
} from '@/services/eval/runners/ablation-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ablationPayloadSchema = z.object({
  ablationType: z.enum([
    'hybrid_vs_dense',
    'bayesian_shrinkage',
    'slot_locking',
    'hallucination_guard',
    'thinking_budget',
  ]),
});

export async function GET(request: Request): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;

  try {
    const ablations = listAvailableAblations();
    return Response.json({
      success: true,
      ablations,
    });
  } catch (error) {
    return Response.json(
      { success: false, error: diagnoseEvaluationError(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ success: false, error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parsed = ablationPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid ablation options' },
        { status: 422 },
      );
    }

    const report = runAblationComparison(parsed.data.ablationType as AblationType);

    return Response.json({
      success: true,
      report,
    });
  } catch (error) {
    return Response.json(
      { success: false, error: diagnoseEvaluationError(error) },
      { status: 500 },
    );
  }
}

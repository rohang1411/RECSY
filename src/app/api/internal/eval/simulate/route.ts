import { z } from 'zod';
import { getDb } from '@/services/db/client';
import { evalAccessError } from '@/services/eval/access';
import { diagnoseEvaluationError } from '@/services/eval/errors';
import { loadEvaluationFixtures } from '@/services/eval/preflight';
import { runInteractiveSimulation } from '@/services/eval/runners/simulation-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const simulatePayloadSchema = z.object({
  queryType: z.enum(['recommender', 'rag', 'hallucination']).default('recommender'),
  caseId: z.string().optional(),
  customInput: z
    .object({
      userQuery: z.string().optional(),
      phoneSlug: z.string().optional(),
    })
    .optional(),
  providerTrack: z.enum(['stub', 'live']).default('stub'),
});

export async function GET(request: Request): Promise<Response> {
  const denied = evalAccessError(request);
  if (denied) return denied;

  try {
    const fixtures = await loadEvaluationFixtures();

    const personas = fixtures.golden.recommenderPersonas.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      query: p.userQuery,
      expectNoResults: p.expectNoResults ?? false,
    }));

    const qaQueries = fixtures.golden.attributedQaQueries.map((q) => ({
      id: q.id,
      phoneSlug: q.phoneSlug,
      category: q.category,
      query: q.query,
      referenceFacts: q.referenceFacts,
    }));

    return Response.json({
      success: true,
      personas,
      qaQueries,
      totalPersonas: personas.length,
      totalQaQueries: qaQueries.length,
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

    const parsed = simulatePayloadSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid simulation options' },
        { status: 422 },
      );
    }

    let db;
    try {
      db = getDb();
    } catch {
      // In offline/test environments, DB is gracefully null and simulation uses in-memory catalog
      db = undefined;
    }

    const simulationResult = await runInteractiveSimulation({
      db,
      queryType: parsed.data.queryType,
      caseId: parsed.data.caseId,
      customInput: parsed.data.customInput,
      providerTrack: parsed.data.providerTrack,
    });

    return Response.json({
      success: true,
      simulation: simulationResult,
    });
  } catch (error) {
    return Response.json(
      { success: false, error: diagnoseEvaluationError(error) },
      { status: 500 },
    );
  }
}

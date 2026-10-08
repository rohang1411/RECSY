import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '@/env';
import { readRequestJson } from '@/lib/request-json';
import { evalAccessError } from '@/services/eval/access';
import { readCampaignArtifacts, importBlindedReview } from '@/services/eval/campaign-artifacts';
import { diagnoseEvaluationError } from '@/services/eval/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function deny(request: Request) {
  return (
    evalAccessError(request) ??
    (env.NODE_ENV !== 'development' || !env.DATABASE_SCHEMA.startsWith('eval_')
      ? Response.json(
          { error: 'Campaign artifacts are available in local isolated staging only' },
          { status: 404 },
        )
      : null)
  );
}
export async function GET(request: Request) {
  const denied = deny(request);
  if (denied) return denied;
  try {
    const campaign = await readCampaignArtifacts();
    if (new URL(request.url).searchParams.get('artifact') === 'review') {
      return new Response(await readFile(resolve(campaign.qualityDir, 'review.html'), 'utf8'), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'; sandbox allow-scripts allow-downloads",
        },
      });
    }
    return Response.json(
      { summary: campaign.summary, isolation: campaign.stage.isolation },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    return Response.json(
      {
        error: diagnoseEvaluationError(error),
        nextAction:
          'Prepare the isolated stage, corpus, capped quality pilot and review package using the evaluation operator guide.',
      },
      { status: 422 },
    );
  }
}
export async function POST(request: Request) {
  const denied = deny(request);
  if (denied) return denied;
  try {
    return Response.json({
      summary: await importBlindedReview(await readRequestJson(request, 1_000_000)),
    });
  } catch (error) {
    return Response.json({ error: diagnoseEvaluationError(error) }, { status: 422 });
  }
}

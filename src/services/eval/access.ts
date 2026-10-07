import { timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

/** The eval API can write large runs, invoke models, and expose user queries. */
export function evalAccessError(request: Request): Response | null {
  if (env.NODE_ENV !== 'production') return null;
  if (!env.INTERNAL_DASHBOARD_ENABLED)
    return Response.json({ error: 'Evaluation portal is disabled' }, { status: 404 });
  const expected = env.INTERNAL_EVAL_TOKEN;
  if (!expected)
    return Response.json(
      { error: 'Evaluation API is locked: configure INTERNAL_EVAL_TOKEN (at least 16 characters)' },
      { status: 503 },
    );
  const provided = request.headers.get('x-recsy-eval-token') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return Response.json(
      { error: 'Evaluation access token is missing or invalid' },
      { status: 401 },
    );
  return null;
}

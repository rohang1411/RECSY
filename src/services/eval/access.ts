import { timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

function isLoopbackDev(request: Request): boolean {
  if (env.NODE_ENV !== 'development') return false;
  const host = request.headers.get('host')?.split(':')[0]?.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1';
}

/** The eval API can write large runs, invoke models, and expose user queries. */
export function evalAccessError(request: Request): Response | null {
  if (!env.INTERNAL_DASHBOARD_ENABLED) {
    return Response.json({ error: 'Evaluation portal is disabled' }, { status: 404 });
  }

  const expected = env.INTERNAL_EVAL_TOKEN || env.INTERNAL_OPERATOR_TOKEN;

  // Local development convenience: permit unauthenticated access only on loopback localhost
  if (!expected && isLoopbackDev(request)) {
    return null;
  }

  if (!expected) {
    return Response.json(
      { error: 'Evaluation API is locked: configure INTERNAL_EVAL_TOKEN (at least 16 characters)' },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get('x-recsy-eval-token') ||
    request.headers.get('x-eval-token') ||
    request.headers.get('x-operator-token') ||
    '';

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json(
      { error: 'Evaluation access token is missing or invalid' },
      { status: 401 },
    );
  }
  return null;
}

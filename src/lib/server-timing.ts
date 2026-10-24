import type { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  OPERATOR_COOKIE_NAME,
  verifyOperatorSessionToken,
  verifyOperatorToken,
} from '@/services/internal/auth';

/**
 * Stage timings can reveal cache state, so they must not be public.
 * They are emitted only when NODE_ENV !== 'production' or request carries
 * a verified operator session or token.
 * Normative reference: Plan 26 WP-00 step 4.
 */
export function shouldEmitServerTiming(request: NextRequest): boolean {
  if (env.NODE_ENV !== 'production') {
    return true;
  }
  const cookieToken = request.cookies.get(OPERATOR_COOKIE_NAME)?.value;
  if (cookieToken && verifyOperatorSessionToken(cookieToken)) {
    return true;
  }
  const headerToken = request.headers.get('x-operator-token');
  if (headerToken && verifyOperatorToken(headerToken)) {
    return true;
  }
  return false;
}

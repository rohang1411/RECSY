/**
 * Internal Operator Authentication & Access Control.
 *
 * Implements server-side operator session management for all `/internal/*` routes.
 *
 * Requirements (Phase A / DB-05):
 * - Fail closed if internal dashboards are disabled or operator token is not configured.
 * - Secure, HttpOnly operator session cookie rather than URL tokens, query strings, or browser-visible secrets.
 * - Header-based fallback (`x-operator-token`) for automated/CLI callers.
 * - Enforce authorization checks before starting database promises.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { env } from '@/env';

export const OPERATOR_COOKIE_NAME = 'recsy_operator_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface SessionPayload {
  readonly iat: number;
  readonly exp: number;
}

function getOperatorSecret(): string | null {
  const secret = env.INTERNAL_OPERATOR_TOKEN || env.INTERNAL_EVAL_TOKEN;
  if (!secret || secret.trim().length === 0) {
    return null;
  }
  return secret.trim();
}

/**
 * Sign a session payload with HMAC-SHA256.
 */
function signPayload(payload: SessionPayload, secret: string): string {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Verify a signed session token.
 */
export function verifyOperatorSessionToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const secret = getOperatorSecret();
  if (!secret) return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [data, signature] = parts;
  if (!data || !signature) return false;

  const expectedSignature = createHmac('sha256', secret).update(data).digest('base64url');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  try {
    const json = Buffer.from(data, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as SessionPayload;
    if (typeof payload.exp !== 'number' || Date.now() > payload.exp) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison of operator token.
 */
export function verifyOperatorToken(candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const secret = getOperatorSecret();
  if (!secret) return false;

  const candidateBuf = Buffer.from(candidate);
  const secretBuf = Buffer.from(secret);

  if (candidateBuf.length !== secretBuf.length) {
    return false;
  }

  return timingSafeEqual(candidateBuf, secretBuf);
}

/**
 * Create a signed session token if the provided operator candidate token is valid.
 */
export function createOperatorSession(candidateToken: string): string | null {
  if (!verifyOperatorToken(candidateToken)) {
    return null;
  }
  const secret = getOperatorSecret();
  if (!secret) return null;

  const now = Date.now();
  const payload: SessionPayload = {
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  return signPayload(payload, secret);
}

/**
 * Verify operator authorization in server components or route handlers.
 */
export async function isOperatorAuthorized(): Promise<boolean> {
  // Fail closed if internal dashboard is not enabled
  if (!env.INTERNAL_DASHBOARD_ENABLED) {
    return false;
  }

  const secret = getOperatorSecret();
  // In development, if no secret is configured, allow local operator convenience
  if (env.NODE_ENV !== 'production' && !secret) {
    return true;
  }

  if (!secret) {
    return false; // Fail closed in production when secret is missing
  }

  // Check header for automated/CLI callers
  try {
    const h = await headers();
    const tokenHeader = h.get('x-operator-token') || h.get('x-eval-token');
    if (tokenHeader && verifyOperatorToken(tokenHeader)) {
      return true;
    }
  } catch {
    // ignore
  }

  // Check session cookie
  try {
    const c = await cookies();
    const sessionCookie = c.get(OPERATOR_COOKIE_NAME)?.value;
    if (sessionCookie && verifyOperatorSessionToken(sessionCookie)) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

export class OperatorAccessDeniedError extends Error {
  constructor(message = 'Operator access denied') {
    super(message);
    this.name = 'OperatorAccessDeniedError';
  }
}

/**
 * Enforces internal access before starting database queries or route logic.
 */
export async function requireInternalAccess(): Promise<void> {
  const authorized = await isOperatorAuthorized();
  if (!authorized) {
    throw new OperatorAccessDeniedError();
  }
}

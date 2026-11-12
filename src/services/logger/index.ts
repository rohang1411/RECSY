/**
 * Structured logging service.
 *
 * Design goals:
 *   - One JSON line per event (parseable by Vercel, Datadog, Loki).
 *   - Automatic trace context (`trace_id`, `session_id`, `route`).
 *   - Pretty-printed in development; raw JSON in preview/production.
 *   - Never logs secrets or raw PII; callers are responsible for redaction.
 *
 * Usage:
 *   import { logger } from '@/services/logger';
 *   logger.info({ phoneSlug: 'pixel-9-pro' }, 'loaded phone page');
 *
 * In a route handler, prefer:
 *   const log = logger.child({ traceId, route: 'GET /api/ask' });
 *   log.info({ latencyMs }, 'answered query');
 */
import { createHmac } from 'node:crypto';
import pino, { type Logger } from 'pino';

import { env } from '@/env';

/**
 * Fields stripped from log payloads to avoid leaking secrets accidentally.
 * Pino's built-in `redact` accepts JSONPath-like expressions.
 */
const REDACT_PATHS = [
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'authorization',
  'headers.authorization',
  'headers.cookie',
  'cookie',
  'token',
  '*.token',
  'userByokKey',
  '*.userByokKey',
  'headers.x-recsy-user-key',
  '*.x-recsy-user-key',
  'stripe-signature',
  '*.stripe-signature',
  'headers.stripe-signature',
  'x-turnstile-token',
  '*.x-turnstile-token',
  'headers.x-turnstile-token',
  'email',
  '*.email',
  'clientSecret',
  '*.clientSecret',
  'secret',
  '*.secret',
  'sb-*',
  '*.sb-*',
] as const;

function createLogger(): Logger {
  const isDev = env.NODE_ENV === 'development';

  return pino({
    level: env.LOG_LEVEL,
    base: {
      service: 'recsy-v2',
      env: env.NODE_ENV,
      commit: env.NEXT_PUBLIC_COMMIT_SHA,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...REDACT_PATHS], remove: true },
    formatters: {
      level: (label) => ({ level: label }),
    },
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env,commit',
          },
        }
      : undefined,
  });
}

/** Singleton root logger. Use `logger.child({...})` per request for context. */
export const logger: Logger = createLogger();

/**
 * Helper: build a child logger with standard request-scoped bindings.
 */
export function requestLogger(bindings: {
  traceId: string;
  route?: string;
  sessionId?: string;
}): Logger {
  return logger.child(bindings);
}

/**
 * Creates a salted 8-character hex digest of an email for privacy-preserving logging.
 * Normative reference: Section 10.7 of plan 25.
 */
export function emailRef(email?: string | null): string {
  if (!email?.trim()) return 'none';
  const salt = env.IP_HASH_SECRET || 'recsy-dev-salt';
  return createHmac('sha256', salt).update(email.toLowerCase().trim()).digest('hex').slice(0, 8);
}

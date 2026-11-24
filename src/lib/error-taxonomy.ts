/**
 * 8-Dimension Typed Error Taxonomy & Canonical Error Response Types (Plan 32 WP-07).
 *
 * Provides deterministic error codes, HTTP status mapping, retry-after durations,
 * and canonical JSON response payloads across edge proxies, rate limiters,
 * LLM gateway, PostgreSQL pooler, and client fetchers.
 */
import { z, ZodError } from 'zod';
import {
  AccountRestrictedError,
  AppError,
  ByokError,
  LlmError,
  LlmSchemaViolation,
  LlmTimeoutError,
  QuotaDeniedError,
  RateLimitError,
  publicErrorMessage,
} from '@/lib/errors';

export const ErrorCategorySchema = z.enum([
  'VALIDATION',
  'QUOTA_EXHAUSTED',
  'RATE_LIMITED',
  'BYOK_REJECTED',
  'BYOK_RATE_LIMITED',
  'BYOK_DAILY_CAP',
  'LLM_GATEWAY_ERROR',
  'DB_TIMEOUT',
  'DB_UNAVAILABLE',
  'INTEGRITY_AUDIT_FAIL',
  'INTERNAL',
]);

export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

export interface CanonicalErrorResponse {
  readonly code: ErrorCategory | string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSec?: number;
}

export interface ClassifiedError {
  readonly category: ErrorCategory;
  readonly status: number;
  readonly message: string;
  readonly retryAfterSec?: number;
  readonly details?: Record<string, unknown>;
}

/**
 * Checks if an error represents a database statement timeout.
 */
export function isDbTimeoutError(err: unknown): boolean {
  if (err instanceof AppError && err.code === 'DB_TIMEOUT') return true;
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    if (code === '57014') return true;
    if (
      /statement_timeout|canceling statement due to statement timeout|timeout.*database/i.test(
        err.message,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if an error represents database unavailability, connection refusal, or pool exhaustion.
 */
export function isDbUnavailableError(err: unknown): boolean {
  if (
    err instanceof AppError &&
    (err.code === 'DB_UNAVAILABLE' || err.code === 'METERING_UNAVAILABLE')
  ) {
    return true;
  }
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    if (
      code === '53300' ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03' ||
      code === '08000' ||
      code === '08003' ||
      code === '08006' ||
      code === 'ECONNREFUSED' ||
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'CONNECTION_CLOSED'
    ) {
      return true;
    }
    if (
      /ECONNREFUSED|ECONNRESET|pool.*drained|Connection closed|connection.*terminated|max.*connections.*reached/i.test(
        err.message,
      )
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Classifies any thrown error into the 8-dimension canonical taxonomy.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof ZodError) {
    return {
      category: 'VALIDATION',
      status: 400,
      message: err.issues[0]?.message ?? 'Invalid request body',
      details: err.flatten(),
    };
  }

  if (err instanceof QuotaDeniedError) {
    const retryAfter =
      err.code === 'TOO_MANY_INFLIGHT' || err.code === 'DUPLICATE_REQUEST'
        ? 2
        : err.code === 'CAPACITY_BUSY'
          ? 30
          : undefined;

    return {
      category: 'QUOTA_EXHAUSTED',
      status: err.status,
      message: err.message,
      retryAfterSec: retryAfter,
      details: {
        quota: err.quota,
        actions: err.actions,
      },
    };
  }

  if (err instanceof RateLimitError) {
    return {
      category: 'RATE_LIMITED',
      status: 429,
      message: 'Too many requests',
      retryAfterSec: 60,
    };
  }

  if (err instanceof ByokError) {
    let category: ErrorCategory = 'BYOK_REJECTED';
    if (err.code === 'BYOK_RATE_LIMITED') {
      category = 'BYOK_RATE_LIMITED';
    } else if (err.code === 'BYOK_UNSUPPORTED') {
      category = 'BYOK_REJECTED';
    }
    return {
      category,
      status: err.status,
      message: err.message,
    };
  }

  if (
    err instanceof LlmError ||
    err instanceof LlmTimeoutError ||
    err instanceof LlmSchemaViolation ||
    (err instanceof AppError &&
      (err.code === 'LLM_ERROR' ||
        err.code === 'LLM_TIMEOUT' ||
        err.code === 'LLM_SCHEMA_VIOLATION' ||
        err.code === 'INTEGRATION_ERROR'))
  ) {
    const isCircuitOpen =
      err instanceof AppError &&
      (err.context?.circuitOpen === true || /circuit.*open/i.test(err.message));
    return {
      category: 'LLM_GATEWAY_ERROR',
      status: err instanceof AppError ? err.status : 502,
      message:
        err instanceof AppError
          ? publicErrorMessage(err)
          : 'The answer service is unavailable. Please try again.',
      retryAfterSec: isCircuitOpen ? 10 : undefined,
    };
  }

  if (err instanceof AccountRestrictedError) {
    return {
      category: 'INTERNAL',
      status: 403,
      message: err.message,
    };
  }

  // Database timeout or pool exhaustion
  if (isDbTimeoutError(err) || isDbUnavailableError(err)) {
    const isTimeout = isDbTimeoutError(err);
    return {
      category: isTimeout ? 'DB_TIMEOUT' : 'DB_UNAVAILABLE',
      status: 503,
      message: 'Database service is temporarily unavailable',
      retryAfterSec: 5,
    };
  }

  // Dimension 7: Integrity Audit / Inconsistency
  if (
    (err instanceof AppError && err.code === 'INTEGRITY_AUDIT_FAIL') ||
    (err instanceof Error && /integrity.*audit.*fail/i.test(err.message))
  ) {
    return {
      category: 'INTEGRITY_AUDIT_FAIL',
      status: 500,
      message: err instanceof AppError ? publicErrorMessage(err) : 'System integrity audit failed',
    };
  }

  if (err instanceof AppError) {
    return {
      category: 'INTERNAL',
      status: err.status,
      message: publicErrorMessage(err),
    };
  }

  return {
    category: 'INTERNAL',
    status: 500,
    message: 'Internal server error',
  };
}

/**
 * Typed application errors.
 *
 * Rules:
 *   - Never throw raw strings. Always throw a subclass of `AppError`.
 *   - Include `context` for debuggability (IDs, model names, etc.) but NEVER
 *     include secrets or raw PII.
 *   - Preserve the underlying cause via `options.cause`.
 */

export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'LLM_ERROR'
  | 'LLM_TIMEOUT'
  | 'LLM_SCHEMA_VIOLATION'
  | 'INTEGRATION_ERROR'
  | 'INTERNAL'
  // plan25 metering, auth, billing codes
  | 'QUOTA_EXHAUSTED'
  | 'SUBSCRIPTION_EXHAUSTED'
  | 'ANON_QUOTA_EXHAUSTED'
  | 'ANON_IP_CAP'
  | 'SIGNIN_REQUIRED'
  | 'DEVICE_ACCOUNT_CAP'
  | 'BYOK_DAILY_CAP'
  | 'TOO_MANY_INFLIGHT'
  | 'DUPLICATE_REQUEST'
  | 'CAPACITY_BUSY'
  | 'PLATFORM_PAUSED'
  | 'METERING_UNAVAILABLE'
  | 'AUTH_UNAVAILABLE'
  | 'BYOK_REJECTED'
  | 'BYOK_UNSUPPORTED'
  | 'BYOK_RATE_LIMITED'
  | 'ACCOUNT_RESTRICTED'
  | 'CAPTCHA_REQUIRED'
  | 'BAD_ORIGIN'
  | 'BILLING_HOLD'
  | 'BILLING_NOT_AVAILABLE'
  | 'ALREADY_SUBSCRIBED'
  | 'NO_BILLING_ACCOUNT'
  | 'BILLING_UNAVAILABLE'
  | 'REAUTH_REQUIRED'
  | 'INVALID_CODE';

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  LLM_ERROR: 502,
  LLM_TIMEOUT: 504,
  LLM_SCHEMA_VIOLATION: 502,
  INTEGRATION_ERROR: 502,
  INTERNAL: 500,
  QUOTA_EXHAUSTED: 402,
  SUBSCRIPTION_EXHAUSTED: 402,
  ANON_QUOTA_EXHAUSTED: 402,
  ANON_IP_CAP: 402,
  SIGNIN_REQUIRED: 402,
  DEVICE_ACCOUNT_CAP: 402,
  BYOK_DAILY_CAP: 402,
  TOO_MANY_INFLIGHT: 429,
  DUPLICATE_REQUEST: 409,
  CAPACITY_BUSY: 503,
  PLATFORM_PAUSED: 503,
  METERING_UNAVAILABLE: 503,
  AUTH_UNAVAILABLE: 503,
  BYOK_REJECTED: 400,
  BYOK_UNSUPPORTED: 400,
  BYOK_RATE_LIMITED: 429,
  ACCOUNT_RESTRICTED: 403,
  CAPTCHA_REQUIRED: 428,
  BAD_ORIGIN: 403,
  BILLING_HOLD: 409,
  BILLING_NOT_AVAILABLE: 403,
  ALREADY_SUBSCRIBED: 409,
  NO_BILLING_ACCOUNT: 404,
  BILLING_UNAVAILABLE: 503,
  REAUTH_REQUIRED: 401,
  INVALID_CODE: 400,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(
    code: ErrorCode,
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown; status?: number },
  ) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options?.status ?? DEFAULT_STATUS[code];
    this.context = Object.freeze({ ...(options?.context ?? {}) });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super('VALIDATION', message, { context, cause });
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, context?: Record<string, unknown>) {
    super('NOT_FOUND', `${resource} not found`, { context });
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', context?: Record<string, unknown>) {
    super('UNAUTHORIZED', message, { context });
    this.name = 'UnauthorizedError';
  }
}

export class AccountRestrictedError extends AppError {
  constructor(message = 'Your account has been restricted', context?: Record<string, unknown>) {
    super('ACCOUNT_RESTRICTED', message, { context });
    this.name = 'AccountRestrictedError';
  }
}

export class RateLimitError extends AppError {
  constructor(context?: Record<string, unknown>) {
    super('RATE_LIMITED', 'Too many requests', { context });
    this.name = 'RateLimitError';
  }
}

export class LlmTimeoutError extends AppError {
  constructor(
    message = 'LLM operation timed out',
    context?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super('LLM_TIMEOUT', message, { context, cause });
    this.name = 'LlmTimeoutError';
  }
}

export class LlmError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super('LLM_ERROR', message, { context, cause });
    this.name = 'LlmError';
  }
}

export class LlmSchemaViolation extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super('LLM_SCHEMA_VIOLATION', message, { context, cause });
    this.name = 'LlmSchemaViolation';
  }
}

export class IntegrationError extends AppError {
  constructor(message: string, context?: Record<string, unknown>, cause?: unknown) {
    super('INTEGRATION_ERROR', message, { context, cause });
    this.name = 'IntegrationError';
  }
}

export class ByokError extends AppError {
  constructor(
    code: 'BYOK_REJECTED' | 'BYOK_UNSUPPORTED' | 'BYOK_RATE_LIMITED',
    message: string,
    options?: { context?: Record<string, unknown>; cause?: unknown; status?: number },
  ) {
    super(code, message, options);
    this.name = 'ByokError';
  }
}

/**
 * Maps underlying provider errors to typed BYOK application errors (Section 7.6).
 * 401/403 -> BYOK_REJECTED (400)
 * 429 -> BYOK_RATE_LIMITED (429)
 */
export function mapByokError(err: unknown): never {
  if (
    err instanceof AppError &&
    (err.code === 'BYOK_REJECTED' ||
      err.code === 'BYOK_UNSUPPORTED' ||
      err.code === 'BYOK_RATE_LIMITED')
  ) {
    throw err;
  }
  const status =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    (err as { context?: { status?: number } })?.context?.status;

  const msg = err instanceof Error ? err.message : String(err);

  if (
    status === 401 ||
    status === 403 ||
    /API_KEY_INVALID|INVALID_ARGUMENT|unauthenticated|unauthorized|forbidden|invalid.*key|authentication.*failed|401|403/i.test(
      msg,
    )
  ) {
    throw new AppError('BYOK_REJECTED', 'Your API key was rejected by the provider', {
      cause: err,
      status: 400,
    });
  }

  if (status === 429 || /RESOURCE_EXHAUSTED|rate.*limit|quota.*exceeded|429/i.test(msg)) {
    throw new AppError('BYOK_RATE_LIMITED', 'Your API key was rate limited by the provider', {
      cause: err,
      status: 429,
    });
  }

  if (err instanceof AppError) throw err;
  throw new LlmError(`BYOK provider call failed: ${msg}`, {}, err);
}

export class QuotaDeniedError extends AppError {
  readonly quota: Readonly<Record<string, unknown>>;
  readonly actions: readonly string[];

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      status?: number;
      quota: Record<string, unknown>;
      actions?: readonly string[];
      context?: Record<string, unknown>;
      cause?: unknown;
    },
  ) {
    super(code, message, {
      status: options.status ?? DEFAULT_STATUS[code],
      context: options.context,
      cause: options.cause,
    });
    this.name = 'QuotaDeniedError';
    this.quota = Object.freeze({ ...options.quota });
    this.actions = Object.freeze([...(options.actions ?? [])]);
  }
}

/**
 * Type guard narrowing `unknown` to `AppError`.
 */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/**
 * Normalize an unknown throwable into an `AppError`, preserving context.
 * Use at API boundaries so that downstream code can always rely on the
 * `AppError` contract.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    let causeStr = 'no cause';
    const errorWithMetadata = err as Error & { cause?: unknown; code?: unknown };
    if ('cause' in err) causeStr = String(errorWithMetadata.cause);
    if ('code' in err) causeStr += ` | code: ${String(errorWithMetadata.code)}`;
    return new AppError('INTERNAL', `${err.message} [CAUSE: ${causeStr}]`, { cause: err });
  }
  return new AppError('INTERNAL', 'Unknown error', { context: { raw: String(err) } });
}

/** Public responses carry stable codes and trace IDs; operator logs retain causes. */
export function publicErrorMessage(error: AppError): string {
  switch (error.code) {
    case 'INTERNAL':
      return 'The request could not be completed. Please try again.';
    case 'INTEGRATION_ERROR':
      return 'A required service is unavailable. Please try again.';
    case 'LLM_ERROR':
      return 'The answer service is unavailable. Please try again.';
    case 'LLM_TIMEOUT':
      return 'The answer service timed out. Please try again.';
    case 'LLM_SCHEMA_VIOLATION':
      return 'The answer service returned an invalid response. Please try again.';
    default:
      return error.message;
  }
}

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
  | 'INTERNAL';

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

export class RateLimitError extends AppError {
  constructor(context?: Record<string, unknown>) {
    super('RATE_LIMITED', 'Too many requests', { context });
    this.name = 'RateLimitError';
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
    if ('cause' in err) causeStr = String((err as any).cause);
    if ('code' in err) causeStr += ` | code: ${(err as any).code}`;
    return new AppError('INTERNAL', `${err.message} [CAUSE: ${causeStr}]`, { cause: err });
  }
  return new AppError('INTERNAL', 'Unknown error', { context: { raw: String(err) } });
}

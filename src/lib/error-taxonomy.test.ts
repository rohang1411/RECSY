import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AccountRestrictedError,
  AppError,
  ByokError,
  LlmError,
  LlmTimeoutError,
  QuotaDeniedError,
  RateLimitError,
} from '@/lib/errors';
import { classifyError, ErrorCategorySchema } from './error-taxonomy';

describe('8-Dimension Typed Error Taxonomy (Plan 32 WP-07)', () => {
  it('validates ErrorCategory schema enum', () => {
    expect(ErrorCategorySchema.parse('VALIDATION')).toBe('VALIDATION');
    expect(ErrorCategorySchema.parse('QUOTA_EXHAUSTED')).toBe('QUOTA_EXHAUSTED');
    expect(ErrorCategorySchema.parse('RATE_LIMITED')).toBe('RATE_LIMITED');
    expect(ErrorCategorySchema.parse('BYOK_REJECTED')).toBe('BYOK_REJECTED');
    expect(ErrorCategorySchema.parse('BYOK_RATE_LIMITED')).toBe('BYOK_RATE_LIMITED');
    expect(ErrorCategorySchema.parse('BYOK_DAILY_CAP')).toBe('BYOK_DAILY_CAP');
    expect(ErrorCategorySchema.parse('LLM_GATEWAY_ERROR')).toBe('LLM_GATEWAY_ERROR');
    expect(ErrorCategorySchema.parse('DB_TIMEOUT')).toBe('DB_TIMEOUT');
    expect(ErrorCategorySchema.parse('DB_UNAVAILABLE')).toBe('DB_UNAVAILABLE');
    expect(ErrorCategorySchema.parse('INTEGRITY_AUDIT_FAIL')).toBe('INTEGRITY_AUDIT_FAIL');
    expect(ErrorCategorySchema.parse('INTERNAL')).toBe('INTERNAL');
    expect(() => ErrorCategorySchema.parse('UNKNOWN_CODE')).toThrow();
  });

  it('classifies ZodError into VALIDATION with 400 and structured details', () => {
    const schema = z.object({ query: z.string().min(5) });
    const result = schema.safeParse({ query: 'hi' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const classified = classifyError(result.error);
      expect(classified.category).toBe('VALIDATION');
      expect(classified.status).toBe(400);
      expect(typeof classified.message).toBe('string');
      expect(classified.message.length).toBeGreaterThan(0);
      expect(classified.details).toBeDefined();
    }
  });

  it('classifies QuotaDeniedError with retryAfterSec', () => {
    const inflightErr = new QuotaDeniedError('TOO_MANY_INFLIGHT', 'Too many requests');
    const inflight = classifyError(inflightErr);
    expect(inflight.category).toBe('QUOTA_EXHAUSTED');
    expect(inflight.status).toBe(429);
    expect(inflight.retryAfterSec).toBe(2);

    const busyErr = new QuotaDeniedError('CAPACITY_BUSY', 'Server capacity busy');
    const busy = classifyError(busyErr);
    expect(busy.category).toBe('QUOTA_EXHAUSTED');
    expect(busy.status).toBe(503);
    expect(busy.retryAfterSec).toBe(30);
  });

  it('classifies RateLimitError into RATE_LIMITED with 429 and retryAfterSec 60', () => {
    const err = new RateLimitError({ ip: '127.0.0.1' });
    const classified = classifyError(err);
    expect(classified.category).toBe('RATE_LIMITED');
    expect(classified.status).toBe(429);
    expect(classified.retryAfterSec).toBe(60);
  });

  it('classifies ByokError variants', () => {
    const rejected = classifyError(new ByokError('BYOK_REJECTED', 'Invalid key', { status: 401 }));
    expect(rejected.category).toBe('BYOK_REJECTED');
    expect(rejected.status).toBe(401);

    const rateLimited = classifyError(
      new ByokError('BYOK_RATE_LIMITED', 'Rate limited', { status: 429 }),
    );
    expect(rateLimited.category).toBe('BYOK_RATE_LIMITED');
    expect(rateLimited.status).toBe(429);
  });

  it('classifies LLM upstream errors into LLM_GATEWAY_ERROR', () => {
    const llmErr = new LlmError('Upstream Gemini failure');
    const classified1 = classifyError(llmErr);
    expect(classified1.category).toBe('LLM_GATEWAY_ERROR');
    expect(classified1.status).toBe(502);

    const timeoutErr = new LlmTimeoutError('Gemini call timed out');
    const classified2 = classifyError(timeoutErr);
    expect(classified2.category).toBe('LLM_GATEWAY_ERROR');
    expect(classified2.status).toBe(504);

    const circuitOpenErr = new AppError('LLM_ERROR', 'Circuit breaker open for model', {
      context: { circuitOpen: true },
      status: 503,
    });
    const classified3 = classifyError(circuitOpenErr);
    expect(classified3.category).toBe('LLM_GATEWAY_ERROR');
    expect(classified3.status).toBe(503);
    expect(classified3.retryAfterSec).toBe(10);
  });

  it('classifies Database timeout and unavailability into 503 with retry-after 5s', () => {
    const dbTimeoutErr = new AppError('DB_TIMEOUT', 'Statement timeout', { status: 503 });
    const classified1 = classifyError(dbTimeoutErr);
    expect(classified1.category).toBe('DB_TIMEOUT');
    expect(classified1.status).toBe(503);
    expect(classified1.retryAfterSec).toBe(5);

    const pgErr = new Error('canceling statement due to statement timeout');
    pgErr.name = 'PostgresError';
    const classified2 = classifyError(pgErr);
    expect(classified2.category).toBe('DB_TIMEOUT');
    expect(classified2.status).toBe(503);
    expect(classified2.retryAfterSec).toBe(5);

    const connRefused = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const classified3 = classifyError(connRefused);
    expect(classified3.category).toBe('DB_UNAVAILABLE');
    expect(classified3.status).toBe(503);
    expect(classified3.retryAfterSec).toBe(5);

    // Postgres syntax error or constraint error is NOT DB_UNAVAILABLE; it must map to 500 INTERNAL
    const syntaxErr = new Error('syntax error at or near "FROM"');
    syntaxErr.name = 'PostgresError';
    (syntaxErr as { code?: string }).code = '42601';
    const classified4 = classifyError(syntaxErr);
    expect(classified4.category).toBe('INTERNAL');
    expect(classified4.status).toBe(500);
  });

  it('classifies integrity audit failures into INTEGRITY_AUDIT_FAIL', () => {
    const auditErr = new AppError('INTEGRITY_AUDIT_FAIL', 'System integrity audit inconsistency', {
      status: 500,
    });
    const classified = classifyError(auditErr);
    expect(classified.category).toBe('INTEGRITY_AUDIT_FAIL');
    expect(classified.status).toBe(500);
    expect(classified.message).toBe('System integrity audit inconsistency');
  });

  it('classifies unknown errors into 500 INTERNAL', () => {
    const unknownErr = new Error('Disk read failure');
    const classified = classifyError(unknownErr);
    expect(classified.category).toBe('INTERNAL');
    expect(classified.status).toBe(500);
    expect(classified.message).toBe('Internal server error');

    const accountRestricted = new AccountRestrictedError();
    const restricted = classifyError(accountRestricted);
    expect(restricted.category).toBe('INTERNAL');
    expect(restricted.status).toBe(403);
  });
});

import { describe, expect, it } from 'vitest';

import { NotFoundError } from '@/lib/errors';

import { classifyIngestError, computeRetryAfter } from './error-classify';

describe('classifyIngestError', () => {
  it('maps NotFoundError to not_found', () => {
    expect(classifyIngestError(new NotFoundError('gone'))).toBe('not_found');
  });

  it('maps quota messages to quota_exceeded', () => {
    expect(classifyIngestError(new Error('RESOURCE_EXHAUSTED: quota'))).toBe('quota_exceeded');
    expect(classifyIngestError(new Error('daily request budget reached'))).toBe('quota_exceeded');
  });

  it('maps AI_RetryError to quota_exceeded', () => {
    const err = new Error('retries exhausted');
    err.name = 'AI_RetryError';
    expect(classifyIngestError(err)).toBe('quota_exceeded');
  });

  it('maps rate limit to rate_limit', () => {
    expect(classifyIngestError(new Error('429 Too Many Requests'))).toBe('rate_limit');
  });

  it('maps unknown errors to unknown', () => {
    expect(classifyIngestError(new Error('something else'))).toBe('unknown');
  });
});

describe('computeRetryAfter', () => {
  it('returns next UTC day for quota_exceeded', () => {
    const from = new Date('2026-05-15T14:00:00.000Z');
    const retry = computeRetryAfter('quota_exceeded', from);
    expect(retry).toEqual(new Date('2026-05-16T00:05:00.000Z'));
  });

  it('returns null for not_found', () => {
    expect(computeRetryAfter('not_found')).toBeNull();
  });
});

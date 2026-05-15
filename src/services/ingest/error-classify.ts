import { NotFoundError } from '@/lib/errors';

import type { IngestErrorCode } from './types';

/**
 * Classify an ingestion error into a machine-readable code for retry routing.
 */
export function classifyIngestError(err: unknown): IngestErrorCode {
  if (err instanceof NotFoundError) return 'not_found';

  const msg = err instanceof Error ? err.message : String(err);

  if (
    /RESOURCE_EXHAUSTED|exceeded your current quota|quota exceeded|daily request budget reached/i.test(
      msg,
    )
  ) {
    return 'quota_exceeded';
  }
  if (/rate.?limit|429|too many requests/i.test(msg)) return 'rate_limit';
  if (/network|ECONNREFUSED|ETIMEDOUT|fetch failed|socket hang up/i.test(msg)) {
    return 'network_error';
  }
  if (/schema.*validation|validation.*failed|ZodError/i.test(msg)) return 'schema_error';
  if (err instanceof Error && err.name === 'AI_RetryError') return 'quota_exceeded';

  return 'unknown';
}

/**
 * Earliest UTC time a quota-exhausted source should be retried.
 * Returns null for non-quota errors (eligible immediately).
 */
export function computeRetryAfter(code: IngestErrorCode, from: Date = new Date()): Date | null {
  if (code !== 'quota_exceeded') return null;
  return new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + 1, 0, 5, 0),
  );
}

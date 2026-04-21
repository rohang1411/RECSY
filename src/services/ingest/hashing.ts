/**
 * Content hashing for ingest deduplication.
 *
 * `content_hash` is the gate that decides whether a re-fetch is a no-op.
 * The hash MUST be stable across:
 *   - URL tracking-param differences,
 *   - whitespace normalisation,
 *   - byte-for-byte equality of the extracted body.
 *
 * Adapters call this on the canonical body text (post extraction, post
 * normalisation), not on the raw HTTP response.
 */
import { createHash } from 'node:crypto';

/** sha256 hex of the input string. Lower-case, 64-char. */
export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

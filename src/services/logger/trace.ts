/**
 * Minimal trace-id generator. Not a full OpenTelemetry tracer — just enough
 * context to correlate logs within a single request without pulling in an
 * observability SDK on the edge runtime.
 */

/**
 * Generate a 16-character hex trace id suitable for inclusion in log lines.
 * Uses `crypto.randomUUID` (available in Node 19+ and the Edge runtime) and
 * strips dashes to keep log lines compact.
 */
export function newTraceId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16);
}

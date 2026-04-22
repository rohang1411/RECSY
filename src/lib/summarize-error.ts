import { ZodError } from 'zod';

/**
 * Safe for Pino: strings only, no raw user message content unless it was part
 * of an `Error#message` from our stack (Zod, AI SDK, etc.).
 */
function oneLayer(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues
      .map((i) => {
        const p = i.path.length ? i.path.map(String).join('.') : 'root';
        return `${p}: ${i.message}`;
      })
      .join('; ');
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

/**
 * Flattens `Error` / `ZodError` and optional `error.cause` chains into one
 * string for local debugging (terminal or dev-only JSON). Not for user-facing
 * copy in production.
 */
export function summarizeErrorChainForLogs(err: unknown, maxLength = 4_000): string {
  const parts: string[] = [];
  let cur: unknown = err;
  let depth = 0;
  const maxDepth = 8;
  const seen = new Set<unknown>();

  while (cur != null && depth < maxDepth) {
    if (seen.has(cur)) {
      parts.push('(circular cause)');
      break;
    }
    seen.add(cur);
    parts.push(oneLayer(cur));
    const next: unknown =
      cur instanceof Error && 'cause' in cur && (cur as Error & { cause?: unknown }).cause != null
        ? (cur as Error & { cause: unknown }).cause
        : undefined;
    if (next === undefined) break;
    cur = next;
    depth += 1;
  }

  return parts.join(' || ').slice(0, maxLength);
}

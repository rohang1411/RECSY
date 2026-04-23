/**
 * Framework-agnostic utilities used across the app. Keep this module free of
 * React and Next.js imports so it remains tree-shakable and testable in pure
 * Node environments.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes with de-duplication, resolving utility conflicts.
 * Canonical helper used by nearly every component.
 *
 * @example cn('p-2', isActive && 'bg-primary', 'p-4') // => 'bg-primary p-4'
 */
export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Assert an unreachable branch at compile time. Throws at runtime so that
 * mistyped enums surface loudly in dev/test rather than silently falling
 * through.
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message ?? `Unreachable case: ${JSON.stringify(value)}`);
}

/**
 * Sleep for the given number of milliseconds. Used by retry helpers.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lightweight exponential backoff helper for idempotent async operations.
 * Not a full retry policy library — keep logic simple, log on each attempt.
 *
 * @param fn             Operation to retry.
 * @param opts.attempts  Max total attempts (default 3).
 * @param opts.baseMs    Initial delay in milliseconds (default 250).
 * @param opts.factor    Delay multiplier per attempt (default 2).
 * @param opts.onRetry   Invoked before each retry with the caught error.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: {
    attempts?: number;
    baseMs?: number;
    factor?: number;
    onRetry?: (err: unknown, attempt: number) => void;
  } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 250;
  const factor = opts.factor ?? 2;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === attempts) break;
      opts.onRetry?.(err, attempt);
      await sleep(baseMs * Math.pow(factor, attempt - 1));
    }
  }
  throw lastErr;
}

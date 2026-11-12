/**
 * Post-response task execution helper (Plan 26 WP-04/WP-10).
 *
 * Runs non-critical side effects (telemetry, caching) after the response
 * has been sent to the client when running in Next.js request scope via `after()`.
 * Outside request scope (scripts, tests, evals), executes inline to ensure completion.
 */
import { after } from 'next/server';
import { logger } from '@/services/logger';

const log = logger.child({ component: 'defer' });

function logDeferredFailure(label: string, err: unknown): void {
  log.warn({ label, err }, 'deferred task failed');
}

/**
 * Runs task after the response when inside a Next.js request; otherwise awaits it inline.
 * Never throws.
 */
export async function deferOrRun(label: string, task: () => Promise<void>): Promise<void> {
  try {
    after(async () => {
      try {
        await task();
      } catch (err) {
        logDeferredFailure(label, err);
      }
    });
  } catch {
    // Outside a request scope (scripts, tests, build): run inline so nothing is lost.
    try {
      await task();
    } catch (err) {
      logDeferredFailure(label, err);
    }
  }
}

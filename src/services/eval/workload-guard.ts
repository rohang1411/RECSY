/**
 * Evaluation Workload Guard.
 *
 * Enforces strict workload boundaries to protect hosted databases (such as Supabase Free Tier)
 * from accidental load tests, destructive staging schemas, and uncached egress exhaustion.
 *
 * Root Cause Context:
 * In October 2026, 780-request HTTP load tests targeted a logical staging schema (`eval_*`)
 * hosted on the production Supabase database. Because `EVAL_HTTP_URL` checked loopback (`127.0.0.1`)
 * but `DATABASE_URL` pointed to Supabase, 5.135 GB of egress was billed to the shared pooler in a single day.
 *
 * This guard ensures that all load tests, staging copies, and benchmarks default to an isolated
 * local database (localhost/Docker), failing fast before creating schemas, running queries,
 * or invoking model stubs.
 */
import { env } from '@/env';
import { normalizeDatabaseUrl } from '@/services/db/connection';

const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'db',
  'postgres',
  'host.docker.internal',
]);

/**
 * Determine whether a database URL points to a hosted (remote) database rather than a local instance.
 */
export function isHostedDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const normalized = normalizeDatabaseUrl(url);
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();

    if (LOCAL_HOSTNAMES.has(hostname)) {
      return false;
    }

    // Explicit user-configured local aliases
    const extraLocal =
      env.EVAL_EXTRA_LOCAL_DB_HOSTS?.split(',').map((h) => h.trim().toLowerCase()) ?? [];
    if (extraLocal.includes(hostname)) {
      return false;
    }

    return true;
  } catch {
    // If URL cannot be parsed, treat as potentially unsafe hosted
    return true;
  }
}

export interface AssertWorkloadOptions {
  readonly action: string;
  readonly databaseUrl?: string;
  /** Allow an explicitly bounded smoke check with no corpus clone or load sweep. */
  readonly allowSmoke?: boolean;
}

/**
 * Asserts that the target database is safe for evaluation activities.
 * Rejects hosted databases for load-stress, staging creation, and fault injection.
 */
export function assertEvaluationDatabaseSafety(opts: AssertWorkloadOptions): void {
  const dbUrl = opts.databaseUrl ?? env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(`[workload-guard] Cannot verify database safety: DATABASE_URL is not set.`);
  }

  const isHosted = isHostedDatabaseUrl(dbUrl);
  if (!isHosted) {
    return;
  }

  // Check if hosted load is explicitly disabled (default)
  const allowHostedLoad = env.EVAL_ALLOW_HOSTED_LOAD;

  if (opts.allowSmoke && (env.EVAL_SMOKE || process.argv.includes('--smoke'))) {
    // Bounded functional smoke allowed with explicit notice
    console.warn(
      `[workload-guard] WARNING: Running bounded functional smoke against HOSTED database. No corpus clones or load sweeps permitted.`,
    );
    return;
  }

  if (!allowHostedLoad) {
    let hostname = 'remote';
    try {
      hostname = new URL(normalizeDatabaseUrl(dbUrl)).hostname;
    } catch {
      // ignore
    }

    throw new Error(
      `[workload-guard] REJECTED: ${opts.action} cannot be executed against hosted database (${hostname}). ` +
        `Hosted evaluation load testing, schema staging, and benchmarks breach Supabase egress quotas. ` +
        `Point DATABASE_URL to a local PostgreSQL instance (e.g. postgresql://postgres:postgres@localhost:5432/recsy_local) ` +
        `or use local Docker. If running an intentional bounded smoke test, supply --smoke.`,
    );
  }
}

/**
 * Database connection helpers — URL normalisation and connectivity utilities.
 *
 * `normalizeDatabaseUrl(url)` strips Supavisor-only query params
 * (`?pgbouncer=true&connection_limit=1`) that Vercel injects into
 * `DATABASE_URL` but that the Porsager `postgres` driver does not understand.
 *
 * `shouldPreferIpv4ForDatabaseUrl(url)` returns `true` for Supabase hostnames;
 * combined with `setDefaultResultOrder('ipv4first')` this prevents GitHub
 * Actions runners from resolving Supabase to an unreachable IPv6 address.
 *
 * `getPostgresClient(url)` applies both normalisations and returns a configured
 * `postgres` client instance. Called by `src/services/db/client.ts`.
 *
 * Used by: `src/services/db/client.ts`, `scripts/db-setup.ts`.
 */
import { setDefaultResultOrder } from 'node:dns';
import { isIP } from 'node:net';

import postgres from 'postgres';

let hasPreferredIpv4 = false;

export function normalizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('pgbouncer');
    parsed.searchParams.delete('connection_limit');
    return parsed.toString();
  } catch {
    return url;
  }
}

export function shouldPreferIpv4ForDatabaseUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (!hostname || isIP(hostname) !== 0) {
      return false;
    }

    return hostname.endsWith('.supabase.co') || hostname.endsWith('.supabase.com');
  } catch {
    return false;
  }
}

export function configureDatabaseNetworking(url: string): void {
  if (hasPreferredIpv4 || !shouldPreferIpv4ForDatabaseUrl(url)) {
    return;
  }

  // GitHub Actions and other hosted runtimes often cannot reach Supabase over
  // IPv6. Prefer IPv4 DNS answers first so the Postgres driver does not stick
  // to an unreachable AAAA record and fail before it ever tries the A record.
  setDefaultResultOrder('ipv4first');
  hasPreferredIpv4 = true;
}

export function createPostgresClient(
  url: string,
  options?: Parameters<typeof postgres>[1],
): ReturnType<typeof postgres> {
  const normalizedUrl = normalizeDatabaseUrl(url);
  configureDatabaseNetworking(normalizedUrl);
  return postgres(normalizedUrl, options);
}

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

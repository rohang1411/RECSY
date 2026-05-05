import { describe, expect, it } from 'vitest';

import { normalizeDatabaseUrl, shouldPreferIpv4ForDatabaseUrl } from './connection';

describe('db connection helpers', () => {
  it('removes Supavisor-only startup params but keeps other query params', () => {
    expect(
      normalizeDatabaseUrl(
        'postgresql://user:pass@db.example.supabase.co:5432/postgres?sslmode=require&pgbouncer=true&connection_limit=1',
      ),
    ).toBe('postgresql://user:pass@db.example.supabase.co:5432/postgres?sslmode=require');
  });

  it('prefers ipv4 for Supabase hostnames', () => {
    expect(
      shouldPreferIpv4ForDatabaseUrl(
        'postgresql://user:pass@db.abcdefghijklmnop.supabase.co:5432/postgres',
      ),
    ).toBe(true);
    expect(
      shouldPreferIpv4ForDatabaseUrl(
        'postgresql://user:pass@aws-0-us-west-1.pooler.supabase.com:6543/postgres',
      ),
    ).toBe(true);
  });

  it('leaves local and literal-ip hosts alone', () => {
    expect(shouldPreferIpv4ForDatabaseUrl('postgresql://user:pass@localhost:5432/postgres')).toBe(
      false,
    );
    expect(shouldPreferIpv4ForDatabaseUrl('postgresql://user:pass@127.0.0.1:5432/postgres')).toBe(
      false,
    );
  });
});

/**
 * Unit tests for database connection helpers (`connection.ts`).
 *
 * Tests cover: Supavisor param stripping (pgbouncer, connection_limit),
 * preservation of unrelated query params, IPv4 preference detection for
 * Supabase hostnames, and pass-through for non-Supabase URLs. Pure.
 */
import { describe, expect, it } from 'vitest';

import { closeDb, getPostgres, pingDatabase } from './client';
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

  it('safely handles closeDb when client is uninitialized or already closed', async () => {
    // Calling closeDb when uninitialized is a safe no-op
    await expect(closeDb()).resolves.toBeUndefined();
    await expect(closeDb({ timeout: 1 })).resolves.toBeUndefined();
  });

  it('drains and resets initialized client singleton', async () => {
    const client1 = getPostgres();
    expect(client1).toBeDefined();
    await expect(closeDb({ timeout: 1 })).resolves.toBeUndefined();
    const client2 = getPostgres();
    expect(client2).toBeDefined();
    expect(client2).not.toBe(client1);
    await closeDb({ timeout: 1 });
  });

  it('pingDatabase handles unreachable database gracefully without throwing', async () => {
    const res = await pingDatabase(200);
    expect(res).toBeDefined();
    expect(typeof res.ok).toBe('boolean');
    expect(typeof res.latencyMs).toBe('number');
    if (!res.ok) {
      expect(typeof res.error).toBe('string');
    }
    await closeDb({ timeout: 1 });
  });
});

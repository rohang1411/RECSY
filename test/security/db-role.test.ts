import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('WP-20 least-privilege db role (recsy_app)', () => {
  const root = resolve(__dirname, '../..');
  const journalPath = resolve(root, 'drizzle/migrations/meta/_journal.json');
  const migrationPath = resolve(root, 'drizzle/migrations/0015_recsy_app_role.sql');
  const docPath = resolve(root, 'docs/deployment/least-privilege-db-role.md');

  it('registers 0015_recsy_app_role in drizzle journal', () => {
    const raw = readFileSync(journalPath, 'utf8');
    const journal = JSON.parse(raw);
    const entry = journal.entries.find((e: { tag: string }) => e.tag === '0015_recsy_app_role');
    expect(entry).toBeDefined();
    expect(entry.idx).toBe(15);
  });

  it('declares safe role creation with LOGIN and NOINHERIT', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recsy_app')");
    expect(sql).toContain('CREATE ROLE recsy_app WITH LOGIN NOINHERIT;');
  });

  it('revokes CREATE on schema public to disallow DDL', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('REVOKE CREATE ON SCHEMA public FROM recsy_app;');
  });

  it('grants required DML on application tables and sequences in public', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('GRANT USAGE ON SCHEMA public TO recsy_app;');
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO recsy_app;',
    );
    expect(sql).toContain('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO recsy_app;');
    expect(sql).toContain('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO recsy_app;');
  });

  it('configures default privileges for newly created public objects', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO recsy_app;',
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO recsy_app;',
    );
    expect(sql).toContain(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO recsy_app;',
    );
  });

  it('revokes access from sensitive administrative and internal schemas', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("'auth'");
    expect(sql).toContain("'storage'");
    expect(sql).toContain("'cron'");
    expect(sql).toContain('REVOKE ALL ON SCHEMA %I FROM recsy_app');
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM recsy_app');
  });

  it('provides deployment guide for runtime connection switching', () => {
    const doc = readFileSync(docPath, 'utf8');
    expect(doc).toContain('recsy_app');
    expect(doc).toContain('DATABASE_URL');
    expect(doc).toContain('ALTER ROLE recsy_app WITH PASSWORD');
    expect(doc.toLowerCase()).toContain('least-privilege');
  });
});

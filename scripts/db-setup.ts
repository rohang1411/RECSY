#!/usr/bin/env tsx
/**
 * Idempotent end-to-end database setup for RECSY v2.
 *
 * Steps (in strict order):
 *   1. Enable extensions (pgvector, pg_trgm, pgcrypto, optionally pg_cron)
 *   2. Apply Drizzle migrations from `drizzle/migrations/`
 *   3. Apply full-text search indexes from `drizzle/fts.sql` (Phase 3)
 *   4. Apply RLS policies from `drizzle/rls.sql`
 *   5. Seed aspect_definitions + 20 starter phones
 *
 * Why one orchestrator instead of `pnpm db:migrate` plus a `psql` script?
 *   - Cross-platform (Windows/macOS/Linux) without requiring `psql`.
 *   - Single connection, single error reporting surface.
 *   - Step 2 depends on step 1 having run first (HNSW indexes reference
 *     `vector_cosine_ops`), which Drizzle's migrate runner can't enforce.
 *
 * Re-running is safe — extensions use `IF NOT EXISTS`, migrations track
 * applied state in `__drizzle_migrations`, RLS uses `DROP POLICY IF EXISTS`
 * before recreating, and seeds use `ON CONFLICT DO UPDATE`.
 *
 * Usage:
 *   pnpm db:setup
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type postgres from 'postgres';

import { createPostgresClient } from '../src/services/db/connection';
import { runSeeds } from './seed';

const STEP = (n: number, name: string) =>
  // Setup is a CLI tool; logger is overkill and we want bare-metal output.

  console.log(`\n[db:setup] step ${n}/5 - ${name}`);

const ROOT = resolve(__dirname, '..');
const FTS_SQL = resolve(ROOT, 'drizzle', 'fts.sql');
const RLS_SQL = resolve(ROOT, 'drizzle', 'rls.sql');
const MIGRATIONS_DIR = resolve(ROOT, 'drizzle', 'migrations');
const REQUIRED_EXTENSION_STATEMENTS = [
  'CREATE SCHEMA IF NOT EXISTS extensions;',
  'CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;',
  'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;',
  'CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;',
] as const;
const OPTIONAL_EXTENSION_STATEMENTS = ['CREATE EXTENSION IF NOT EXISTS pg_cron;'] as const;

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required. Populate .env.local first.');
  }

  // Disable prepared statements — Supabase pgbouncer (transaction mode)
  // does not support them and the migrator runs many ad-hoc statements.
  const client = createPostgresClient(url, { max: 1, prepare: false });
  const db = drizzle(client);

  try {
    // Vector + trigram types live in `extensions` on Supabase; vanilla Postgres
    // CI images need this search_path for unqualified `vector` in migrations.
    await client`select set_config('search_path', 'public, extensions', false)`;

    STEP(1, 'enabling extensions');
    await ensureExtensions(client);

    STEP(2, 'applying migrations');
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    STEP(3, 'applying FTS indexes');
    const ftsSQL = await readFile(FTS_SQL, 'utf8');
    await runMultiStatementSQL(client, ftsSQL);

    STEP(4, 'applying RLS policies');
    const rlsSQL = await readFile(RLS_SQL, 'utf8');
    await runMultiStatementSQL(client, rlsSQL);

    STEP(5, 'seeding aspect_definitions + phones + ingestion profiles');
    const summary = await runSeeds(db);
    log(
      `        aspects: ${summary.aspects.upserted}, phones: ${summary.phones.upserted}, ` +
        `creators: ${summary.creatorProfiles.upserted} ` +
        `(disabled stale: ${summary.creatorProfiles.disabledStale}), ` +
        `subreddits: ${summary.subredditProfiles.upserted}, ` +
        `domains: ${summary.domainProfiles.upserted}, ` +
        `aliases: ${summary.phoneAliases.upserted}, ` +
        `catalog profiles: ${summary.catalogSourceProfiles.upserted}`,
    );

    log('\n[db:setup] OK - all five steps completed.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

/**
 * Run a SQL file containing multiple statements via Postgres' simple query
 * protocol. The `postgres` driver normally uses extended-protocol prepared
 * statements which only allow a single statement per round-trip.
 */
async function runMultiStatementSQL(sql: postgres.Sql, text: string): Promise<void> {
  await sql.unsafe(text).simple();
}

async function ensureExtensions(sql: postgres.Sql): Promise<void> {
  for (const stmt of REQUIRED_EXTENSION_STATEMENTS) {
    await sql.unsafe(stmt).simple();
  }

  for (const stmt of OPTIONAL_EXTENSION_STATEMENTS) {
    try {
      await sql.unsafe(stmt).simple();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`        warn: ${msg.slice(0, 200)}`);
    }
  }
}

function log(msg: string): void {
  console.log(msg);
}

main().catch((err) => {
  console.error('\n[db:setup] FAILED');

  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});

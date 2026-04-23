#!/usr/bin/env tsx
/**
 * One-shot connectivity sanity check.
 *
 * Reads `DATABASE_URL` from `.env.local` (passed via `--env-file`), opens a
 * single connection, runs `select version()`, and closes.
 *
 * Usage: `pnpm db:ping`
 */
import postgres from 'postgres';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Did you fill in .env.local?');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 10 });

  try {
    const started = Date.now();
    const rows = await sql`
      select version() as version, current_database() as db, current_user as role
    `;
    const latency = Date.now() - started;
    const row = rows[0];
    console.log('[db-ping] connected');
    console.log(`  role      : ${row?.role}`);
    console.log(`  database  : ${row?.db}`);
    console.log(`  version   : ${row?.version}`);
    console.log(`  latency   : ${latency}ms`);
  } catch (err) {
    console.error('[db-ping] FAILED');
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

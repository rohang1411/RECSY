#!/usr/bin/env tsx
/**
 * DEV-ONLY: drop the entire `public` schema and re-run `db:setup`.
 *
 * Refuses to run unless `RECSY_ALLOW_DB_RESET=1` is set, to make accidental
 * production wipes impossible. Refuses entirely if `NODE_ENV=production`.
 *
 * Usage:
 *   $env:RECSY_ALLOW_DB_RESET="1"; pnpm db:reset      # PowerShell
 *   RECSY_ALLOW_DB_RESET=1 pnpm db:reset              # bash
 */
import { spawn } from 'node:child_process';

import { createPostgresClient } from '../src/services/db/connection';

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:reset is forbidden in production.');
  }
  if (process.env.RECSY_ALLOW_DB_RESET !== '1') {
    throw new Error(
      'Refusing to drop the schema without explicit opt-in. Set RECSY_ALLOW_DB_RESET=1 and retry.',
    );
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required.');

  const client = createPostgresClient(url, { max: 1, prepare: false });
  try {
    log('[db:reset] dropping public schema');
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;').simple();
    log('[db:reset] schema reset complete');
  } finally {
    await client.end({ timeout: 5 });
  }

  log('[db:reset] running db:setup');
  await spawnChild('pnpm', ['exec', 'tsx', 'scripts/db-setup.ts']);
}

function spawnChild(command: string, args: string[]): Promise<void> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', rejectP);
    child.on('exit', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`db:setup exited with code ${code}`));
    });
  });
}

function log(msg: string): void {
  console.log(msg);
}

main().catch((err) => {
  console.error('[db:reset] FAILED');

  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'drizzle-kit';

/**
 * Load `.env.local` / `.env` when drizzle-kit is invoked without `--env-file`
 * (e.g. plain `pnpm db:migrate`). Other scripts use `tsx --env-file=.env.local`.
 */
function loadEnvFiles(): void {
  if (process.env.DATABASE_URL) return;
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
    if (process.env.DATABASE_URL) break;
  }
}

loadEnvFiles();

/**
 * Drizzle Kit configuration.
 *
 * Migrations are generated from the TypeScript schema in `src/services/db/schema.ts`
 * and written to `drizzle/migrations`. Point `DATABASE_URL` at a Supabase Postgres
 * instance with `pgvector`, `pg_trgm`, and `pg_cron` enabled.
 */
export default defineConfig({
  schema: './src/services/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});

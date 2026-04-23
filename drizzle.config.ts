import { defineConfig } from 'drizzle-kit';

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

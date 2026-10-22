import { existsSync } from 'node:fs';

// Ensure environment variables are loaded in child test runner processes before any @/ imports
if (typeof process.loadEnvFile === 'function') {
  if (existsSync('.env.local')) {
    process.loadEnvFile('.env.local');
  } else if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

import { createPostgresClient } from '@/services/db/connection';
import { isHostedDatabaseUrl } from '@/services/eval/workload-guard';

/* eslint-disable no-restricted-syntax -- test bootstrap must inspect process.env before DB initialization */
const dbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) {
  if (process.env.CI) {
    throw new Error('DATABASE_URL environment variable is required in CI for DB tests');
  }
} else if (isHostedDatabaseUrl(dbUrl)) {
  if (process.env.CI) {
    throw new Error(
      `In CI, DB integration tests must run against a local database, not hosted: ${dbUrl}`,
    );
  }
  console.warn(
    `[test:db] Warning: DATABASE_URL points to hosted database. DB integration tests will be skipped locally to protect hosted quota. Start local Postgres to run locally.`,
  );
} else {
  /* eslint-enable no-restricted-syntax */
  // Ensure anon and authenticated roles exist in the local test database so privilege revocation tests can run
  const sql = createPostgresClient(dbUrl, { max: 1 });
  try {
    await sql`
      DO $$
      BEGIN
        PERFORM pg_advisory_xact_lock(88991122);
        BEGIN
          CREATE ROLE anon NOLOGIN;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
          CREATE ROLE authenticated NOLOGIN;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        BEGIN
          CREATE ROLE recsy_app WITH LOGIN NOINHERIT;
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
        -- Grant the test runner user permission to SET ROLE to anon/authenticated/recsy_app
        EXECUTE format('GRANT anon TO %I', CURRENT_USER);
        EXECUTE format('GRANT authenticated TO %I', CURRENT_USER);
        EXECUTE format('GRANT recsy_app TO %I', CURRENT_USER);
      END
      $$;
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

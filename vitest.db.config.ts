import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Load local environment variables if present (CI environment injects them directly).
if (typeof process.loadEnvFile === 'function') {
  if (existsSync('.env.local')) {
    process.loadEnvFile('.env.local');
  } else if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

/**
 * Vitest configuration for live PostgreSQL integration tests.
 *
 * Runs against a real database instance (CI postgres service container or
 * local .env.local DATABASE_URL). Uses the 'forks' pool for process isolation
 * across tests that modify database state.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/db/**/*.test.ts'],
    exclude: ['node_modules', '.next'],
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    setupFiles: ['test/db/setup.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

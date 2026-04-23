import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * `test/setup.ts` pulls in `@testing-library/jest-dom` matchers. Tests live
 * beside the unit under test (`foo.test.ts`) for locality; integration tests
 * that need a real database live under `tests/integration` and are excluded
 * here so that they only run via `pnpm test:integration`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'tests/integration/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['node_modules/', '.next/', 'drizzle/', '**/*.d.ts', '**/*.config.*', 'test/**'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

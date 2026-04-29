import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright — phone UI smoke tests.
 *
 * Requires a bootstrapped Postgres (see `scripts/db-setup.ts`) and a populated
 * `.env.local` so `next dev` can validate `@/env`. In CI the workflow exports
 * equivalent variables and runs `db-setup` before `pnpm e2e`.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm exec next dev --port 3000',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

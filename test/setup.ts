// Vitest does not auto-load `.env.local` like Next.js does. Provide harmless
// placeholder values for anything `src/env.ts` marks required so that modules
// which transitively import `@/env` (e.g. `@/services/logger`) can be loaded
// inside unit tests without the developer needing a full .env.local.
//
// Real secrets still come from process.env when the test harness is invoked
// with them already set (CI, integration runs) — we only fill GAPS.
const TEST_ENV_DEFAULTS: Record<string, string> = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  GEMINI_API_KEY: 'test-gemini-key',
  NODE_ENV: 'development',
};
for (const [k, v] of Object.entries(TEST_ENV_DEFAULTS)) {
  // eslint-disable-next-line no-restricted-syntax -- test bootstrap must seed process env before @/env import
  if (!process.env[k]) process.env[k] = v;
}
// Vitest defaults NODE_ENV to 'test', but our env schema only accepts
// development/preview/production. Override without mutating the reference.
// eslint-disable-next-line no-restricted-syntax -- test bootstrap override before @/env import
if (process.env.NODE_ENV === 'test') {
  // eslint-disable-next-line no-restricted-syntax -- test bootstrap override before @/env import
  Object.assign(process.env, { NODE_ENV: 'development' });
}

import '@testing-library/jest-dom/vitest';

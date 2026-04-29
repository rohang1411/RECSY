/* eslint-disable no-restricted-syntax -- this file tests process.env parsing. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('@/env', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('keeps validation enabled when SKIP_ENV_VALIDATION is "false"', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      SKIP_ENV_VALIDATION: 'false',
    };
    delete process.env.LLM_PROVIDER;

    const { env } = await import('./env');

    expect(env.LLM_PROVIDER).toBe('gemini');
  });

  it('supplies server defaults when SKIP_ENV_VALIDATION is "true"', async () => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      SKIP_ENV_VALIDATION: 'true',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      GEMINI_API_KEY: 'test-gemini-key',
    };
    delete process.env.LOG_LEVEL;
    delete process.env.LLM_PROVIDER;

    const { env } = await import('./env');

    expect(env.LOG_LEVEL).toBe('info');
    expect(env.LLM_PROVIDER).toBe('gemini');
  });
});

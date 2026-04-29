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
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { env } from '@/env';
import { ControlledProvider, isLoopbackDbUrl } from './controlled';

describe('ControlledProvider constructor guards', () => {
  const originalEnv = { ...env };
  const envMock = env as unknown as Record<string, unknown>;

  beforeEach(() => {
    // Valid development baseline
    envMock.NODE_ENV = 'development';
    envMock.DATABASE_SCHEMA = 'eval_test_schema';
    envMock.EVAL_CONTROLLED_PROVIDER_URL = 'http://127.0.0.1:3210';
    envMock.EVAL_CONTROLLED_PROVIDER_TOKEN = 'secret-test-token-12345';
    envMock.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/eval_db';
    envMock.EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD = undefined;
  });

  afterEach(() => {
    Object.assign(env, originalEnv);
  });

  it('isLoopbackDbUrl correctly identifies loopback hosts', () => {
    expect(isLoopbackDbUrl('postgres://localhost:5432/db')).toBe(true);
    expect(isLoopbackDbUrl('postgres://127.0.0.1:5432/db')).toBe(true);
    expect(isLoopbackDbUrl('postgres://user:pass@127.0.0.1:6543/postgres')).toBe(true);
    expect(isLoopbackDbUrl('postgres://db.remote.supabase.co:5432/postgres')).toBe(false);
    expect(isLoopbackDbUrl('invalid-url')).toBe(false);
    expect(isLoopbackDbUrl(undefined)).toBe(false);
  });

  it('instantiates successfully in development mode with valid settings', () => {
    expect(() => new ControlledProvider()).not.toThrow();
  });

  it('throws in production mode without EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD', () => {
    envMock.NODE_ENV = 'production';
    expect(() => new ControlledProvider()).toThrow(/requires development mode/);
  });

  it('throws in production mode if DATABASE_URL is not loopback', () => {
    envMock.NODE_ENV = 'production';
    envMock.EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD = '1';
    envMock.DATABASE_URL = 'postgres://postgres:postgres@db.remote.supabase.co:5432/eval_db';
    expect(() => new ControlledProvider()).toThrow(/requires development mode/);
  });

  it('succeeds in production mode when EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD=1 and DATABASE_URL is loopback', () => {
    envMock.NODE_ENV = 'production';
    envMock.EVAL_CONTROLLED_ALLOW_PRODUCTION_BUILD = '1';
    envMock.DATABASE_URL = 'postgres://postgres:postgres@127.0.0.1:5432/eval_db';
    expect(() => new ControlledProvider()).not.toThrow();
  });

  it('throws if DATABASE_SCHEMA does not start with eval_', () => {
    envMock.DATABASE_SCHEMA = 'public';
    expect(() => new ControlledProvider()).toThrow(/requires development mode/);
  });

  it('throws if EVAL_CONTROLLED_PROVIDER_URL is non-loopback or https', () => {
    envMock.EVAL_CONTROLLED_PROVIDER_URL = 'https://127.0.0.1:3210';
    expect(() => new ControlledProvider()).toThrow(/requires development mode/);

    envMock.EVAL_CONTROLLED_PROVIDER_URL = 'http://external-host.com:3210';
    expect(() => new ControlledProvider()).toThrow(/requires development mode/);
  });

  it('throws if EVAL_CONTROLLED_PROVIDER_TOKEN is missing or empty', () => {
    envMock.EVAL_CONTROLLED_PROVIDER_TOKEN = undefined;
    expect(() => new ControlledProvider()).toThrow(/requires development mode/);
  });
});

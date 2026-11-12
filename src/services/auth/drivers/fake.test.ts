import { describe, expect, it } from 'vitest';
import { assertFakeAuthAllowed } from './fake';

describe('assertFakeAuthAllowed boot validation', () => {
  it('allows localhost and local database', () => {
    expect(() =>
      assertFakeAuthAllowed({
        siteUrl: 'http://localhost:3000',
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/recsy_test',
        nodeEnv: 'test',
      }),
    ).not.toThrow();

    expect(() =>
      assertFakeAuthAllowed({
        siteUrl: 'http://127.0.0.1:3000',
        databaseUrl: 'postgresql://postgres:postgres@127.0.0.1:5432/recsy_test',
        nodeEnv: 'development',
      }),
    ).not.toThrow();
  });

  it('rejects production environment', () => {
    expect(() =>
      assertFakeAuthAllowed({
        siteUrl: 'http://localhost:3000',
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/recsy_test',
        nodeEnv: 'production',
      }),
    ).toThrow(/forbidden in production/);
  });

  it('rejects public hostnames', () => {
    expect(() =>
      assertFakeAuthAllowed({
        siteUrl: 'https://recsy.com',
        databaseUrl: 'postgresql://postgres:postgres@localhost:5432/recsy_test',
        nodeEnv: 'development',
      }),
    ).toThrow(/requires localhost/);
  });

  it('rejects hosted database URLs (e.g. Supabase)', () => {
    expect(() =>
      assertFakeAuthAllowed({
        siteUrl: 'http://localhost:3000',
        databaseUrl: 'postgresql://postgres:secret@db.abcxyz.supabase.co:5432/postgres',
        nodeEnv: 'development',
      }),
    ).toThrow(/forbidden against hosted database URLs/);
  });
});

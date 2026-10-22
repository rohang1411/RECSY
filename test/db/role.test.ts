import { describe, expect, it } from 'vitest';
import { createTestClient, isLocalDb } from './helpers';

describe('least-privilege role recsy_app (WP-20 live tests)', () => {
  const runTest = isLocalDb();

  it.skipIf(!runTest)('enforces schema isolation and restricts DDL', async () => {
    const client = createTestClient({ max: 1 });
    try {
      const roles = await client<{ rolname: string }[]>`
        SELECT rolname FROM pg_roles WHERE rolname = 'recsy_app'
      `;
      if (roles.length === 0) {
        // Migration 0015 not applied in local db yet
        return;
      }

      // Check schema privileges
      const [priv] = await client<
        {
          can_usage: boolean;
          can_create: boolean;
        }[]
      >`
        SELECT 
          has_schema_privilege('recsy_app', 'public', 'USAGE') AS can_usage,
          has_schema_privilege('recsy_app', 'public', 'CREATE') AS can_create
      `;

      expect(priv?.can_usage).toBe(true);
      expect(priv?.can_create).toBe(false);

      // Verify restricted operations in a transaction
      await client.begin(async (tx) => {
        await tx`SET LOCAL ROLE recsy_app`;

        // 1. DML on application table succeeds
        const rows = await tx`SELECT count(*)::int AS count FROM phones`;
        expect(typeof rows[0]?.count).toBe('number');

        // 2. DDL fails with permission denied (run in savepoint so transaction remains usable)
        let ddlFailed = false;
        try {
          await tx.savepoint(async (sp) => {
            await sp`CREATE TABLE __test_ddl_table (id int)`;
          });
        } catch (err: unknown) {
          ddlFailed = true;
          expect(String(err)).toMatch(/permission denied/i);
        }
        expect(ddlFailed).toBe(true);

        // 3. Sensitive schema access fails (if auth schema exists)
        const [authSchema] = await tx<{ exists: boolean }[]>`
          SELECT EXISTS(SELECT 1 FROM information_schema.schemata WHERE schema_name = 'auth') AS exists
        `;
        if (authSchema?.exists) {
          let authFailed = false;
          try {
            await tx.savepoint(async (sp) => {
              await sp`SELECT * FROM auth.users LIMIT 1`;
            });
          } catch (err: unknown) {
            authFailed = true;
            expect(String(err)).toMatch(/permission denied/i);
          }
          expect(authFailed).toBe(true);
        }
      });
    } finally {
      await client.end({ timeout: 5 });
    }
  });
});

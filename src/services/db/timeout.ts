/**
 * Scoped database statement timeout helper (Plan 26 WP-11).
 *
 * Executes a callback within a transaction setting `SET LOCAL statement_timeout`.
 * `SET LOCAL` guarantees that the timeout strictly resets upon transaction
 * COMMIT/ROLLBACK and cannot leak to other transactions behind Supavisor /
 * transaction poolers.
 */
import { sql } from 'drizzle-orm';
import type { AppDb, AppQueryDb } from './client';

export async function withStatementTimeout<T>(
  db: AppQueryDb,
  timeout: string,
  fn: (scopedDb: AppQueryDb) => Promise<T>,
): Promise<T> {
  const maybeDbWithTx = db as Partial<AppDb>;
  if (typeof maybeDbWithTx.transaction === 'function') {
    return await maybeDbWithTx.transaction(async (tx) => {
      // SET LOCAL guarantees statement_timeout will not leak past COMMIT
      await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${timeout}'`));
      return await fn(tx);
    });
  }

  // If already inside a transaction or transaction is unsupported, run directly
  return await fn(db);
}

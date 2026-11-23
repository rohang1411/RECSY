/**
 * Database client (Drizzle ORM over the `postgres` driver).
 *
 * Usage:
 *   import { db } from '@/services/db/client';
 *   const rows = await db.select().from(phones).where(eq(phones.slug, 'pixel-9-pro'));
 *
 * One client per Node process. The driver pools connections internally.
 * The edge runtime cannot use the `postgres` driver — prefer Supabase REST
 * (`@supabase/supabase-js`) for edge routes.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';

import { env } from '@/env';

import { createPostgresClient } from './connection';
import * as schema from './schema';

/**
 * Lazy-init the driver to avoid connecting at import-time in tooling like
 * `next build` that evaluates modules before env is validated.
 */
let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient(): ReturnType<typeof postgres> {
  if (_client === null) {
    _client = createPostgresClient(env.DATABASE_URL, {
      max: env.NODE_ENV === 'production' ? 2 : 4,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false, // required for Supabase's pgbouncer transaction mode
      connection: {
        search_path: `${env.DATABASE_SCHEMA}, extensions`,
        application_name: 'recsy_app',
      },
    });
  }
  return _client;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (_db === null) {
    _db = drizzle(getClient(), { schema, casing: 'snake_case' });
  }
  return _db;
}

/** Drizzle instance type — use in `import type` contexts (avoids value imports only for `typeof`). */
export type AppDb = ReturnType<typeof getDb>;
/** Common query surface for an ordinary database or a transaction. */
export type AppQueryDb = Pick<
  AppDb,
  'select' | 'insert' | 'update' | 'delete' | 'execute' | 'query'
>;

/**
 * Raw `postgres` driver handle — needed by retrieval primitives that issue
 * tagged-template SQL outside Drizzle (vector literals, FTS queries).
 */
export function getPostgres(): ReturnType<typeof postgres> {
  return getClient();
}

/** Convenience re-export — equivalent to `getDb()`. */
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

/**
 * Gracefully closes the database client connection pool.
 * Drains all active queries with a configurable timeout (defaults to 5s).
 * Resets cached client and db singletons for safe test isolation and clean script termination.
 */
export async function closeDb(options?: { timeout?: number }): Promise<void> {
  _db = null;
  if (_client !== null) {
    const clientToClose = _client;
    _client = null;
    await clientToClose.end({ timeout: options?.timeout ?? 5 }).catch(() => undefined);
  }
}

/**
 * Lightweight TCP & database connectivity ping.
 * Executes `SELECT 1 as ping` to verify database reachability and measure query latency.
 * Safe to call during health audits; never throws.
 */
export async function pingDatabase(
  timeoutMs = 2000,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = performance.now();
  try {
    const client = getPostgres();
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      client`SELECT 1 as ping`,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Database ping timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === 'function') {
          timer.unref();
        }
      }),
    ]);
    if (timer) clearTimeout(timer);
    return { ok: true, latencyMs: Math.round((performance.now() - t0) * 10) / 10 };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round((performance.now() - t0) * 10) / 10,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export { schema };

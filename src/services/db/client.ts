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
import postgres from 'postgres';

import { env } from '@/env';

import * as schema from './schema';

/**
 * Lazy-init the driver to avoid connecting at import-time in tooling like
 * `next build` that evaluates modules before env is validated.
 */
let _client: ReturnType<typeof postgres> | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient(): ReturnType<typeof postgres> {
  if (_client === null) {
    // Vercel auto-injected database URLs often contain `?pgbouncer=true` for
    // Prisma compatibility. The `postgres` driver passes unknown query params
    // to the database as startup parameters, which Supavisor rejects, causing
    // the very first query to fail with an oblique "Failed query" wrapper.
    let url = env.DATABASE_URL;
    try {
      const parsed = new URL(url);
      parsed.searchParams.delete('pgbouncer');
      parsed.searchParams.delete('connection_limit');
      url = parsed.toString();
    } catch {
      // Ignore if not a valid URL
    }

    _client = postgres(url, {
      max: env.NODE_ENV === 'production' ? 10 : 3,
      idle_timeout: 20,
      prepare: false, // required for Supabase's pgbouncer transaction mode
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

export { schema };

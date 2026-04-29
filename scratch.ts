import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { rateLimits } from './src/services/db/schema';
import { sql } from 'drizzle-orm';
import { env } from './src/env';

// Convert DB URL to use pooler port 6543
let url = env.DATABASE_URL.replace(':5432/', ':6543/');
if (!url.includes('pgbouncer')) {
  url += url.includes('?') ? '&pgbouncer=true' : '?pgbouncer=true';
}
const client = postgres(url, { prepare: false });
const db = drizzle(client);

async function check() {
  try {
    const windowStart = new Date(Math.floor(Date.now() / 60000) * 60000);
    const [row] = await db
      .insert(rateLimits)
      .values({ key: 'test', windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    console.warn('SUCCESS:', row);
  } catch (e) {
    console.error('ERROR OCCURRED:', e);
  } finally {
    process.exit(0);
  }
}

check();

check();

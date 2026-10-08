import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../src/env';
import { getPostgres } from '../src/services/db/client';
import { createPostgresClient } from '../src/services/db/connection';

async function main() {
  const db = getPostgres();
  try {
    const inventory = await db`
      select p.id, p.slug, p.brand, p.model, p.status,
        count(c.id)::integer as chunk_count,
        count(c.id) filter (where c.embedding is not null)::integer as embedded_chunk_count,
        count(c.id) filter (where s.status = 'active')::integer as active_source_chunk_count,
        count(distinct s.id)::integer as source_count
      from phones p left join chunks c on c.phone_id=p.id
      left join sources s on s.id=c.source_id
      group by p.id order by p.slug`;
    const migrations =
      await db`select hash, created_at from drizzle.__drizzle_migrations order by created_at`;
    const restored = await readFile(
      resolve('drizzle/migrations/0009_multi_session_chat_history.sql'),
      'utf8',
    );
    const originalMigrationHash = createHash('sha256').update(restored).digest('hex');
    const columns = await db`
      select table_name,column_name,is_nullable,column_default from information_schema.columns
      where table_schema='public' and table_name in ('recommendation_clients','recommendation_sessions')
      order by table_name,ordinal_position`;
    let startupSearchPath: unknown;
    const probe = createPostgresClient(env.DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 8,
      connection: { search_path: 'pg_catalog' },
    });
    try {
      startupSearchPath =
        await probe`select current_schema(), current_setting('search_path') as search_path`;
    } catch (error) {
      startupSearchPath = { error: error instanceof Error ? error.message : String(error) };
    } finally {
      await probe.end({ timeout: 2 });
    }
    const output = resolve('output/eval/environment-2026-10-06.json');
    await mkdir(resolve('output/eval'), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          inventory,
          migrations,
          columns,
          restoredMigrationHash: originalMigrationHash,
          restoredMigrationRecorded: migrations.some((row) => row.hash === originalMigrationHash),
          startupSearchPath,
          provider: {
            model: env.LLM_CHAT_MODEL,
            embeddingModel: env.LLM_EMBEDDING_MODEL,
            configuredKeyCount: [
              env.GEMINI_API_KEY,
              env.GEMINI_API_KEY_2,
              env.GEMINI_API_KEY_3,
              env.GEMINI_API_KEY_4,
            ].filter(Boolean).length,
            rateLimitProfile: env.GEMINI_RATE_LIMIT_PROFILE,
          },
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          output,
          phoneCount: inventory.length,
          phonesWithActiveSourceChunks: inventory.filter((row) => row.active_source_chunk_count > 0)
            .length,
          restoredMigrationRecorded: migrations.some((row) => row.hash === originalMigrationHash),
          startupSearchPath,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end({ timeout: 2 });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

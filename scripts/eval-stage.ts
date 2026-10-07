import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../src/env';
import { createPostgresClient } from '../src/services/db/connection';

async function main() {
  const namespace = `eval_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const db = createPostgresClient(env.DATABASE_URL, {
    max: 1,
    prepare: false,
    connection: { search_path: `${namespace}, extensions` },
  });
  const outputDir = resolve('output/eval', namespace);
  await mkdir(outputDir, { recursive: true });
  try {
    if (!/^eval_[0-9]{14}$/.test(namespace)) throw new Error('Invalid staging namespace');
    await db.unsafe(`CREATE SCHEMA "${namespace}"`);
    const journal = JSON.parse(await readFile('drizzle/migrations/meta/_journal.json', 'utf8')) as {
      entries: { tag: string }[];
    };
    const migrations = [];
    for (const entry of journal.entries) {
      const source = await readFile(`drizzle/migrations/${entry.tag}.sql`, 'utf8');
      const scoped = source
        .replaceAll('"public".', `"${namespace}".`)
        .replace(
          /WHERE conname = ('[^']*')/gi,
          `WHERE conname = $1 AND connamespace = '${namespace}'::regnamespace`,
        );
      for (const statement of scoped.split('--> statement-breakpoint').filter((s) => s.trim()))
        await db.unsafe(statement).simple();
      migrations.push({
        tag: entry.tag,
        sha256: createHash('sha256').update(source).digest('hex'),
      });
      console.log(`Applied ${entry.tag} to ${namespace}`);
    }
    await db.unsafe(await readFile('drizzle/fts.sql', 'utf8')).simple();
    await db.unsafe(await readFile('drizzle/rls.sql', 'utf8')).simple();
    const copied: Record<string, number> = {};
    // Catalog/corpus only. Never copy production clients, turns, chat logs, or cache.
    if (!process.argv.includes('--empty'))
      await db.begin('isolation level repeatable read', async (tx) => {
        for (const table of [
          'phones',
          'aspect_definitions',
          'sources',
          'chunks',
          'aspects',
          'phone_regional_details',
        ]) {
          const columns =
            await tx`select column_name,data_type,udt_name from information_schema.columns
          where table_schema=${namespace} and table_name=${table} and is_generated='NEVER'
          and column_name in (select column_name from information_schema.columns where table_schema='public' and table_name=${table})
          order by ordinal_position`;
          if (!columns.length) throw new Error(`Snapshot table ${table} has no compatible columns`);
          const names = columns.map((c) => `"${c.column_name}"`).join(',');
          const expressions = columns
            .map((c) =>
              c.data_type === 'USER-DEFINED' && c.udt_name !== 'vector'
                ? `"${c.column_name}"::text::"${namespace}"."${c.udt_name}"`
                : `"${c.column_name}"`,
            )
            .join(',');
          const result = await tx.unsafe(
            `INSERT INTO "${namespace}"."${table}" (${names}) SELECT ${expressions} FROM public."${table}"`,
          );
          copied[table] = result.count;
        }
      });
    for (const table of [
      'phones',
      'aspect_definitions',
      'sources',
      'chunks',
      'aspects',
      'phone_regional_details',
    ])
      await db.unsafe(`ANALYZE "${namespace}"."${table}"`);
    const manifest = {
      createdAt: new Date().toISOString(),
      namespace,
      outputDir,
      copied,
      migrations,
      isolation:
        'logical schema on the existing database host; not an independent capacity environment',
      productionDataWrites: false,
    };
    await writeFile(resolve(outputDir, 'stage.json'), JSON.stringify(manifest, null, 2));
    await writeFile(resolve('output/eval/current-stage.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
  } finally {
    await db.end({ timeout: 2 });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

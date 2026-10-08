import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postgres from 'postgres';

async function main() {
  const stage = JSON.parse(await readFile('output/eval/current-stage.json', 'utf8'));
  if (!/^eval_[a-z0-9_]+$/.test(stage.namespace)) throw new Error('Invalid isolated schema');
  const sql = postgres(process.env.DATABASE_URL!, {
    max: 1,
    prepare: false,
    connection: { search_path: `${stage.namespace},extensions` },
  });
  const tables = [
    'phones',
    'aspect_definitions',
    'sources',
    'chunks',
    'aspects',
    'phone_regional_details',
  ];
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  try {
    const restore = process.argv.find((arg) => arg.startsWith('--restore='))?.slice(10);
    if (restore) {
      const archive = JSON.parse(await readFile(restore, 'utf8')) as {
        tables: Record<
          string,
          { columns: string[]; rows: Record<string, unknown>[]; sha256: string }
        >;
      };
      for (const table of tables) {
        const data = archive.tables[table];
        if (!data || hash(data.rows) !== data.sha256)
          throw new Error(`Snapshot ${table} missing or hash mismatch`);
        const [count] = await sql.unsafe(
          `SELECT count(*)::int AS n FROM "${stage.namespace}"."${table}"`,
        );
        if (count?.n !== 0) throw new Error(`Refusing restore: ${table} is not empty`);
      }
      await sql.begin(async (tx) => {
        for (const table of tables) {
          const data = archive.tables[table]!;
          const columns =
            await tx`select column_name from information_schema.columns where table_schema=${stage.namespace} and table_name=${table} and is_generated='NEVER' order by ordinal_position`;
          const names = columns.map((c) => String(c.column_name));
          if (names.sort().join('|') !== [...data.columns].sort().join('|'))
            throw new Error(`Snapshot/schema column mismatch for ${table}`);
          const list = names.map((n) => `"${n.replaceAll('"', '""')}"`).join(',');
          for (let i = 0; i < data.rows.length; i += 100)
            await tx.unsafe(
              `INSERT INTO "${stage.namespace}"."${table}" (${list}) SELECT ${list} FROM json_populate_recordset(NULL::"${stage.namespace}"."${table}",$1::text::json)`,
              [JSON.stringify(data.rows.slice(i, i + 100))],
            );
          await tx.unsafe(`ANALYZE "${stage.namespace}"."${table}"`);
        }
      });
      console.log(
        `Restored catalog/corpus into empty ${stage.namespace}; no user/session/cache data included`,
      );
      return;
    }
    const snapshot: Record<
      string,
      { columns: string[]; rows: Record<string, unknown>[]; sha256: string }
    > = {};
    await sql.begin('isolation level repeatable read', async (tx) => {
      for (const table of tables) {
        const columns =
          await tx`select column_name from information_schema.columns where table_schema=${stage.namespace} and table_name=${table} and is_generated='NEVER' order by ordinal_position`;
        const names = columns.map((c) => String(c.column_name));
        const list = names.map((n) => `"${n}"`).join(',');
        const rows = (
          await tx.unsafe(
            `SELECT row_to_json(t) AS data FROM (SELECT ${list} FROM "${stage.namespace}"."${table}" ORDER BY id) t`,
          )
        ).map((r) => r.data as Record<string, unknown>);
        snapshot[table] = { columns: names, rows, sha256: hash(rows) };
      }
    });
    const path = resolve(stage.outputDir, 'database-snapshot.json');
    await writeFile(
      path,
      JSON.stringify({
        at: new Date().toISOString(),
        schema: stage.namespace,
        scope:
          'catalog/corpus only; excludes clients, sessions, turns, chat queries, cache and secrets',
        tables: snapshot,
      }),
    );
    console.log(
      JSON.stringify(
        {
          path,
          tables: Object.fromEntries(
            Object.entries(snapshot).map(([table, value]) => [
              table,
              { rows: value.rows.length, sha256: value.sha256 },
            ]),
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

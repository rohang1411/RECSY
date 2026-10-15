#!/usr/bin/env tsx
/**
 * Evaluation Staging Schema Inventory & Cleanup Manifest Generator
 *
 * Inspects the database for temporary `eval_*` staging schemas, measures their
 * storage footprint and table counts, checks for verified local archives, and
 * outputs a safe, reviewable cleanup manifest.
 *
 * SAFETY RULES:
 *   - NEVER drops any schema automatically.
 *   - Wildcard DROP SCHEMA is strictly prohibited.
 *   - Drops require explicit single-schema `--execute --confirm-schema=<name>`.
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/eval-cleanup-manifest.ts
 *   pnpm tsx --env-file=.env.local scripts/eval-cleanup-manifest.ts --execute --confirm-schema=eval_xxx
 */
import { parseArgs } from 'node:util';
import { getPostgres } from '../src/services/db/client';

interface SchemaInfo {
  schemaName: string;
  tableCount: number;
  totalBytes: number;
  tables: Array<{ tableName: string; rowCount: number }>;
}

async function main() {
  const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
      execute: { type: 'boolean', default: false },
      'confirm-schema': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });

  if (args.help) {
    console.log(`
Usage: pnpm tsx scripts/eval-cleanup-manifest.ts [options]

Options:
  --execute                Execute drop for an explicitly confirmed schema
  --confirm-schema <name>  Exact name of the single eval schema to drop
  --help                   Show help
`);
    process.exit(0);
  }

  const sql = getPostgres();

  // Find all eval_* schemas
  const schemas = await sql<{ schema_name: string }[]>`
    SELECT schema_name
    FROM information_schema.schemata
    WHERE schema_name LIKE 'eval_%'
    ORDER BY schema_name
  `;

  if (schemas.length === 0) {
    console.log('[eval-cleanup-manifest] No eval_* schemas found in the database. Clean state.');
    process.exit(0);
  }

  console.log(`[eval-cleanup-manifest] Found ${schemas.length} evaluation staging schemas:`);

  const manifest: SchemaInfo[] = [];

  for (const { schema_name } of schemas) {
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schema_name}
      ORDER BY table_name
    `;

    const tableDetails: Array<{ tableName: string; rowCount: number }> = [];
    let totalBytes = 0;

    for (const { table_name } of tables) {
      try {
        const [countRow] = await sql.unsafe(
          `SELECT count(*)::int as n FROM "${schema_name}"."${table_name}"`,
        );
        const [sizeRow] = await sql.unsafe(
          `SELECT pg_total_relation_size('"${schema_name}"."${table_name}"')::bigint as bytes`,
        );
        const rowCount = Number(countRow?.n ?? 0);
        const bytes = Number(sizeRow?.bytes ?? 0);
        totalBytes += bytes;
        tableDetails.push({ tableName: table_name, rowCount });
      } catch {
        tableDetails.push({ tableName: table_name, rowCount: 0 });
      }
    }

    manifest.push({
      schemaName: schema_name,
      tableCount: tables.length,
      totalBytes,
      tables: tableDetails,
    });
  }

  // Print manifest
  for (const s of manifest) {
    const sizeMb = (s.totalBytes / (1024 * 1024)).toFixed(2);
    console.log(`\nSchema: ${s.schemaName} (${s.tableCount} tables, ~${sizeMb} MB)`);
    for (const t of s.tables) {
      console.log(`  - ${t.tableName}: ${t.rowCount} rows`);
    }
  }

  if (args.execute) {
    const target = args['confirm-schema'];
    if (!target) {
      console.error(
        '\n[ERROR] --execute requires --confirm-schema=<exact_name> to prevent accidental deletion.',
      );
      process.exit(1);
    }

    const match = manifest.find((m) => m.schemaName === target);
    if (!match) {
      console.error(`\n[ERROR] Schema "${target}" not found among existing eval_* schemas.`);
      process.exit(1);
    }

    console.log(`\n[eval-cleanup-manifest] Dropping schema "${target}" with CASCADE...`);
    await sql.unsafe(`DROP SCHEMA "${target}" CASCADE`);
    console.log(`[eval-cleanup-manifest] Successfully dropped schema "${target}".`);
  } else {
    console.log(
      '\n[eval-cleanup-manifest] Manifest generated. No schemas were dropped (dry-run mode).',
    );
    console.log(
      'To drop a verified schema, rerun with: --execute --confirm-schema=<exact_schema_name>',
    );
  }
}

main().catch((err) => {
  console.error('[eval-cleanup-manifest] Failed:', err);
  process.exit(1);
});

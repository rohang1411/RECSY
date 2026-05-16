/**
 * Database schema guard — pre-flight check for required tables and columns.
 *
 * `checkSchemaRequirements(db, requirements)` queries `information_schema`
 * to verify that all listed tables and optional columns exist before an
 * automation script starts doing real work. On failure it returns a
 * structured `SchemaViolation[]` with actionable operator messages.
 *
 * `hasMissingDbObjectError(err)` detects Drizzle/Postgres errors caused by
 * a missing table or column so callers can distinguish schema-missing failures
 * from ordinary query errors.
 *
 * `describeMissingSchema(violations)` formats a human-readable `pnpm db:setup`
 * prompt for the operator log.
 *
 * Used by: `scripts/{ingest-auto,creator-watch,ingest-report,scorecard-auto}.ts`.
 */
import { sql } from 'drizzle-orm';

import type { AppDb } from './client';

export interface SchemaRequirement {
  readonly table: string;
  readonly columns?: readonly string[];
}

export async function findMissingPublicSchema(
  db: AppDb,
  requirements: readonly SchemaRequirement[],
): Promise<string[]> {
  const rows = await db.execute<{ table_name: string; column_name: string }>(sql`
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
  `);

  const columnsByTable = new Map<string, Set<string>>();
  for (const row of rows) {
    const table = row.table_name;
    const column = row.column_name;
    if (!columnsByTable.has(table)) {
      columnsByTable.set(table, new Set());
    }
    columnsByTable.get(table)!.add(column);
  }

  const missing: string[] = [];
  for (const req of requirements) {
    const columns = columnsByTable.get(req.table);
    if (!columns) {
      missing.push(`table ${req.table}`);
      continue;
    }
    for (const column of req.columns ?? []) {
      if (!columns.has(column)) {
        missing.push(`column ${req.table}.${column}`);
      }
    }
  }

  return missing;
}

export function describeMissingSchema(scriptName: string, missing: readonly string[]): string {
  return (
    `[${scriptName}] automated ingestion schema is incomplete: ${missing.join(', ')}. ` +
    'Run `pnpm db:setup` or apply the latest DB migrations before enabling this workflow.'
  );
}

export function hasMissingDbObjectError(err: unknown): boolean {
  const missingCodes = new Set(['42P01', '42703']);
  let current: unknown = err;
  let depth = 0;
  const seen = new Set<unknown>();

  while (current != null && depth < 8 && !seen.has(current)) {
    seen.add(current);
    if (typeof current === 'object') {
      const code =
        'code' in current && typeof (current as { code?: unknown }).code === 'string'
          ? (current as { code: string }).code
          : null;
      if (code && missingCodes.has(code)) return true;
    }
    current =
      current instanceof Error && 'cause' in current
        ? (current as Error & { cause?: unknown }).cause
        : undefined;
    depth += 1;
  }

  return false;
}

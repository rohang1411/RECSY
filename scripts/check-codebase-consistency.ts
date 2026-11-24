#!/usr/bin/env tsx
/**
 * Ultra-Low-Overhead Static Codebase Consistency & Hygiene Check (Plan 31 WP-12).
 *
 * Verifies critical system invariants with zero network and zero database overhead:
 * 1. Validates all YouTube creator seed channel IDs conform to `/^UC[a-zA-Z0-9_-]{22}$/`.
 * 2. Validates aspect definitions in `src/lib/constants.ts` match Postgres `aspectEnum` values.
 * 3. Scans evaluation runners for unreferenced / dead stubs and exports.
 * 4. Writes `.system/diagnostics/code_hygiene_status.json` for Command Center ingestion.
 *
 * Execution time: < 35ms.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ASPECT_NAMES } from '../src/lib/constants';
import { aspectEnum } from '../src/services/db/schema';
import { CREATOR_SEEDS } from './seed/creator-profiles';

interface ConsistencyReport {
  readonly status: 'pass' | 'fail';
  readonly timestamp: string;
  readonly executionMs: number;
  readonly checks: {
    readonly youtubeCreatorSeeds: {
      readonly total: number;
      readonly valid: number;
      readonly invalid: number;
      readonly errors?: readonly string[];
    };
    readonly aspectDefinitions: {
      readonly constantsCount: number;
      readonly schemaCount: number;
      readonly matches: boolean;
      readonly mismatches?: readonly string[];
    };
    readonly evalRunners: {
      readonly scanned: number;
      readonly orphaned: number;
      readonly status: 'clean' | 'dead_code_detected';
      readonly runners: readonly string[];
    };
    readonly drizzleMigrations: {
      readonly totalSqlFiles: number;
      readonly journalEntries: number;
      readonly status: 'synced' | 'unjournaled_migrations_detected';
      readonly unjournaled?: readonly string[];
    };
  };
}

async function runCodebaseConsistencyCheck(): Promise<boolean> {
  const t0 = performance.now();
  let hasFailure = false;

  console.log('[Hygiene Check] Running static codebase consistency audit...');

  // 1. Audit YouTube Channel IDs
  const ytSeeds = CREATOR_SEEDS.filter((s) => s.platform === 'youtube');
  const YT_CHANNEL_REGEX = /^UC[a-zA-Z0-9_-]{22}$/;
  const invalidYtSeeds: string[] = [];

  for (const seed of ytSeeds) {
    if (!YT_CHANNEL_REGEX.test(seed.externalId)) {
      invalidYtSeeds.push(`${seed.handle} (${seed.externalId})`);
    }
  }

  if (invalidYtSeeds.length > 0) {
    hasFailure = true;
    console.error(
      `  FAIL: Found ${invalidYtSeeds.length} malformed YouTube channel IDs:`,
      invalidYtSeeds,
    );
  } else {
    console.log(
      `  PASS: All ${ytSeeds.length} YouTube creator channel IDs match canonical pattern.`,
    );
  }

  // 2. Audit Aspect Definitions Alignment
  const constantAspects = [...ASPECT_NAMES];
  const schemaAspects = [...aspectEnum.enumValues];
  const missingInSchema = constantAspects.filter((a) => !schemaAspects.includes(a as never));
  const missingInConstants = schemaAspects.filter((a) => !constantAspects.includes(a as never));
  const aspectMatches = missingInSchema.length === 0 && missingInConstants.length === 0;

  if (!aspectMatches) {
    hasFailure = true;
    console.error('  FAIL: Aspect definitions mismatch between constants and database schema:', {
      missingInSchema,
      missingInConstants,
    });
  } else {
    console.log(
      `  PASS: All ${constantAspects.length} aspect definitions perfectly align with database schema.`,
    );
  }

  // 3. Scan Eval Runners for Dead / Orphan Stubs
  const runnersDir = path.join(process.cwd(), 'src', 'services', 'eval', 'runners');
  const runnerFiles = fs.existsSync(runnersDir)
    ? fs.readdirSync(runnersDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    : [];

  const knownPurged: string[] = [];
  const orphanedFound: string[] = [];

  function getAllSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'node_modules' && e.name !== '.next' && e.name !== '.git') {
        files.push(...getAllSourceFiles(full));
      } else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.tsx'))) {
        files.push(full);
      }
    }
    return files;
  }

  const allSourceFiles = [
    ...getAllSourceFiles(path.join(process.cwd(), 'src')),
    ...getAllSourceFiles(path.join(process.cwd(), 'scripts')),
  ];

  for (const runner of runnerFiles) {
    if (knownPurged.includes(runner)) {
      orphanedFound.push(runner);
      continue;
    }
    const baseName = runner.replace(/\.ts$/, '');
    const isReferenced = allSourceFiles.some((sf) => {
      if (path.basename(sf) === runner) return false;
      const content = fs.readFileSync(sf, 'utf8');
      return content.includes(baseName);
    });
    if (!isReferenced) {
      orphanedFound.push(runner);
    }
  }

  if (orphanedFound.length > 0) {
    hasFailure = true;
    console.error(`  FAIL: Orphaned/dead runner stubs detected:`, orphanedFound);
  } else {
    console.log(`  PASS: ${runnerFiles.length} eval runners active, zero orphaned stubs detected.`);
  }

  // 4. Audit Drizzle Migrations Journal Completeness
  const migrationsDir = path.join(process.cwd(), 'drizzle', 'migrations');
  const journalPath = path.join(migrationsDir, 'meta', '_journal.json');
  let totalMigrationFiles = 0;
  let journalEntriesCount = 0;
  let unjournaled: string[] = [];

  if (fs.existsSync(journalPath)) {
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[];
    };
    journalEntriesCount = journal.entries.length;
    const journalTags = new Set(journal.entries.map((e) => e.tag));
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => f.replace(/\.sql$/, ''));
    totalMigrationFiles = sqlFiles.length;
    unjournaled = sqlFiles.filter((tag) => !journalTags.has(tag));

    if (unjournaled.length > 0) {
      hasFailure = true;
      console.error(
        `  FAIL: Found ${unjournaled.length} unjournaled migration(s) in drizzle/migrations:`,
        unjournaled,
      );
    } else {
      console.log(
        `  PASS: All ${totalMigrationFiles} migration SQL files tracked in _journal.json.`,
      );
    }
  }

  const executionMs = Math.round(performance.now() - t0);

  const report: ConsistencyReport = {
    status: hasFailure ? 'fail' : 'pass',
    timestamp: new Date().toISOString(),
    executionMs,
    checks: {
      youtubeCreatorSeeds: {
        total: ytSeeds.length,
        valid: ytSeeds.length - invalidYtSeeds.length,
        invalid: invalidYtSeeds.length,
        errors: invalidYtSeeds.length > 0 ? invalidYtSeeds : undefined,
      },
      aspectDefinitions: {
        constantsCount: constantAspects.length,
        schemaCount: schemaAspects.length,
        matches: aspectMatches,
        mismatches: !aspectMatches ? [...missingInSchema, ...missingInConstants] : undefined,
      },
      evalRunners: {
        scanned: runnerFiles.length,
        orphaned: orphanedFound.length,
        status: orphanedFound.length > 0 ? 'dead_code_detected' : 'clean',
        runners: runnerFiles,
      },
      drizzleMigrations: {
        totalSqlFiles: totalMigrationFiles,
        journalEntries: journalEntriesCount,
        status: unjournaled.length > 0 ? 'unjournaled_migrations_detected' : 'synced',
        unjournaled: unjournaled.length > 0 ? unjournaled : undefined,
      },
    },
  };

  // Write artifact for Command Center radar ingestion
  const outDir = path.join(process.cwd(), '.system', 'diagnostics');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFile = path.join(outDir, 'code_hygiene_status.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), 'utf8');
  console.log(
    `[Hygiene Check] Report written to ${outFile} (${executionMs}ms). Result: ${report.status.toUpperCase()}`,
  );

  return !hasFailure;
}

runCodebaseConsistencyCheck()
  .then((ok) => {
    if (!ok) process.exit(1);
  })
  .catch((err) => {
    console.error('[Hygiene Check] Unhandled exception:', err);
    process.exit(1);
  });

#!/usr/bin/env tsx
/**
 * Import structured phone specs into catalog candidates.
 *
 * This is the no-LLM bulk path for trusted structured sources: OEM exports,
 * licensed API exports, or manually reviewed JSON generated from those
 * sources. Import validates the promotion contract and can optionally promote
 * valid candidates into `phones`.
 *
 * Usage:
 *   pnpm catalog:import-specs --file data/catalog/recent-phones.json --dry-run
 *   pnpm catalog:import-specs --file data/catalog/recent-phones.json --promote
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { eq, sql } from 'drizzle-orm';

import {
  buildCanonicalKey,
  buildPromotionPlan,
  hashJson,
  parseCatalogImportFile,
  promoteCatalogCandidate,
  stableCandidateKey,
} from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';

interface CliArgs {
  readonly file: string | null;
  readonly dryRun: boolean;
  readonly promote: boolean;
  readonly updateExisting: boolean;
  readonly limit: number | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: {
    file: string | null;
    dryRun: boolean;
    promote: boolean;
    updateExisting: boolean;
    limit: number | null;
  } = {
    file: null,
    dryRun: false,
    promote: false,
    updateExisting: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--file':
        args.file = argv[++i] ?? null;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--promote':
        args.promote = true;
        break;
      case '--update-existing':
        args.updateExisting = true;
        break;
      case '--limit':
        args.limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${flag}`);
    }
  }

  if (!args.file) exitWithUsage('--file is required');
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const filePath = resolve(process.cwd(), args.file!);
  const records = parseCatalogImportFile(
    JSON.parse(stripBom(await readFile(filePath, 'utf8'))),
  ).slice(0, args.limit ?? undefined);

  const planned = records.map((record) => {
    const externalId = record.externalId ?? fallbackExternalId(record);
    const canonicalKey = buildCanonicalKey({
      brand: record.brand,
      model: record.model,
      launchDate: record.launchDate,
    });
    const stableKey = stableCandidateKey({
      sourceKey: record.sourceKey,
      externalId,
      sourceUrl: record.sourceUrl,
    });
    const claimsJson = { promotion: record };
    const plan = buildPromotionPlan({
      sourceKey: record.sourceKey,
      externalId,
      sourceUrl: record.sourceUrl,
      canonicalKey,
      claimsJson,
    });
    return { record, externalId, canonicalKey, stableKey, claimsJson, plan };
  });

  const valid = planned.filter((item) => item.plan.ok).length;
  const blocked = planned.length - valid;

  if (args.dryRun) {
    console.log(
      `[catalog:import-specs] dry-run file=${filePath} records=${planned.length} valid=${valid} blocked=${blocked} llm_calls=0`,
    );
    for (const item of planned.slice(0, 20)) {
      const state = item.plan.ok ? 'valid' : `blocked:${item.plan.issues[0]?.code ?? 'unknown'}`;
      console.log(`  ${state} ${item.record.brand} ${item.record.model}`);
    }
    if (planned.length > 20) console.log(`  ... ${planned.length - 20} more`);
    return;
  }

  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    { table: 'catalog_runs' },
    { table: 'catalog_candidates' },
    { table: 'phones', columns: ['canonical_key', 'catalog_last_seen_at'] },
    { table: 'phone_identities' },
    { table: 'phone_aliases' },
    { table: 'phone_configurations' },
    { table: 'catalog_source_claims' },
    { table: 'phone_media_assets' },
    { table: 'catalog_quality_issues' },
  ]);
  if (missing.length > 0) {
    console.warn(describeMissingSchema('catalog:import-specs', missing));
    process.exit(0);
  }

  const startedAt = Date.now();
  const [run] = await db
    .insert(catalogRuns)
    .values({
      kind: 'manual',
      status: 'running',
      stage: args.promote ? 'import_promote' : 'import',
      maxLlmCalls: 0,
      checkpointJson: { file: filePath, promote: args.promote, limit: args.limit },
    })
    .returning({ id: catalogRuns.id });
  if (!run) throw new Error('catalog run insert returned no row');

  let created = 0;
  let updated = 0;
  let promoted = 0;
  let quarantined = 0;

  try {
    for (const item of planned) {
      const prior = await db
        .select({ id: catalogCandidates.id })
        .from(catalogCandidates)
        .where(eq(catalogCandidates.stableKey, item.stableKey))
        .limit(1);
      if (prior.length === 0) created += 1;
      else updated += 1;

      const [candidate] = await db
        .insert(catalogCandidates)
        .values({
          firstRunId: run.id,
          lastRunId: run.id,
          stableKey: item.stableKey,
          sourceKey: item.record.sourceKey,
          sourceType: item.record.sourceType,
          externalId: item.externalId,
          sourceUrl: item.record.sourceUrl ?? null,
          candidateTitle: `${item.record.brand} ${item.record.model}`,
          rawCandidateJson: item.record.raw,
          normalizedIdentityJson: {
            brand: item.record.brand,
            model: item.record.model,
            launchDate: item.record.launchDate ?? null,
            aliases: item.record.aliases,
          },
          claimsJson: item.claimsJson,
          canonicalKey: item.canonicalKey,
          contentHash: hashJson(item.claimsJson),
          decision: item.plan.ok ? 'promote' : 'quarantine',
          status: item.plan.ok ? 'ready_to_promote' : 'quarantined',
          confidence: item.plan.ok ? '0.95' : '0.00',
          issueCodes: item.plan.ok ? [] : [...new Set(item.plan.issues.map((i) => i.code))],
          lastDecisionAt: new Date(),
        })
        .onConflictDoUpdate({
          target: catalogCandidates.stableKey,
          set: {
            lastRunId: sql`excluded.last_run_id`,
            sourceUrl: sql`excluded.source_url`,
            candidateTitle: sql`excluded.candidate_title`,
            rawCandidateJson: sql`excluded.raw_candidate_json`,
            normalizedIdentityJson: sql`excluded.normalized_identity_json`,
            claimsJson: sql`excluded.claims_json`,
            canonicalKey: sql`excluded.canonical_key`,
            contentHash: sql`excluded.content_hash`,
            decision: sql`excluded.decision`,
            status: sql`excluded.status`,
            confidence: sql`excluded.confidence`,
            issueCodes: sql`excluded.issue_codes`,
            seenCount: sql`${catalogCandidates.seenCount} + 1`,
            lastDecisionAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: catalogCandidates.id });

      if (!candidate) throw new Error('candidate upsert returned no row');
      if (!item.plan.ok) {
        quarantined += 1;
        continue;
      }
      if (args.promote) {
        const result = await promoteCatalogCandidate(db, candidate.id, {
          updateExisting: args.updateExisting,
        });
        if (result.action === 'created' || result.action === 'updated') promoted += 1;
        if (result.action === 'blocked') quarantined += 1;
      }
    }

    await db
      .update(catalogRuns)
      .set({
        status: 'success',
        stage: 'done',
        createdCount: created,
        updatedCount: updated + promoted,
        quarantinedCount: quarantined,
        requestCount: 0,
        llmCallCount: 0,
        finishedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(catalogRuns.id, run.id));

    console.log(
      `[catalog:import-specs] done records=${planned.length} created=${created} updated=${updated} promoted=${promoted} quarantined=${quarantined} llm_calls=0`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(catalogRuns)
      .set({
        status: 'failed',
        error: message.slice(0, 2_000),
        errorCode: 'unknown',
        finishedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(catalogRuns.id, run.id));
    throw err;
  }
}

function fallbackExternalId(record: {
  readonly slug?: string;
  readonly brand: string;
  readonly model: string;
  readonly launchDate?: string;
}): string {
  return (
    record.slug ??
    buildCanonicalKey({
      brand: record.brand,
      model: record.model,
      launchDate: record.launchDate,
    })
  );
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:import-specs --file <path> [options]',
      '',
      'Options:',
      '  --file <path>        JSON array or {"phones": [...]} with complete promotion claims',
      '  --dry-run            Validate and print a summary without writing',
      '  --promote            Promote valid candidates after staging',
      '  --update-existing    Refresh existing matched phones during promotion',
      '  --limit N            Only process the first N records',
      '  --help               Print this message',
    ].join('\n'),
  );
}

function exitWithUsage(message: string): never {
  console.error(`[catalog:import-specs] ${message}\n`);
  printUsage();
  process.exit(2);
}

main().catch((err) => {
  console.error('[catalog:import-specs] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

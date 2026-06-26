#!/usr/bin/env tsx
/**
 * Promote staged catalog candidates into canonical `phones`.
 *
 * Promotion makes no LLM calls. It only promotes candidates whose `claims_json`
 * contains a complete `promotion` payload that passes `PhoneSpecSchema`.
 *
 * Usage:
 *   pnpm catalog:promote --candidate <uuid> --dry-run
 *   pnpm catalog:promote --ready --limit 20
 *
 * `--ready` also revalidates staged/quarantined candidates that already carry
 * structured `claims_json.promotion`. This lets gate relaxations move older
 * rows forward without waiting for another external enrichment fetch.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { promoteCatalogCandidate } from '../src/services/catalog';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns } from '../src/services/db/schema';

interface CliArgs {
  readonly candidateId: string | null;
  readonly ready: boolean;
  readonly limit: number;
  readonly dryRun: boolean;
  readonly updateExisting: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: {
    candidateId: string | null;
    ready: boolean;
    limit: number;
    dryRun: boolean;
    updateExisting: boolean;
  } = {
    candidateId: null,
    ready: false,
    limit: 20,
    dryRun: false,
    updateExisting: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--candidate':
        args.candidateId = argv[++i] ?? null;
        break;
      case '--ready':
        args.ready = true;
        break;
      case '--limit':
        args.limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--update-existing':
        args.updateExisting = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${flag}`);
    }
  }

  if (!args.candidateId && !args.ready) {
    exitWithUsage('Provide --candidate <uuid> or --ready');
  }
  if (args.candidateId && args.ready) {
    exitWithUsage('Use only one of --candidate or --ready');
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
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
    console.warn(describeMissingSchema('catalog:promote', missing));
    process.exit(0);
  }

  const candidateIds = args.candidateId
    ? [args.candidateId]
    : (
        await db
          .select({ id: catalogCandidates.id })
          .from(catalogCandidates)
          .where(
            or(
              inArray(catalogCandidates.status, ['ready_to_promote', 'validated']),
              and(
                inArray(catalogCandidates.status, [
                  'discovered',
                  'quarantined',
                  'failed_transient',
                ]),
                sql`${catalogCandidates.claimsJson} ? 'promotion'`,
              ),
            ),
          )
          .orderBy(
            sql`
            case
              when ${catalogCandidates.status} in ('ready_to_promote', 'validated') then 0
              when ${catalogCandidates.status} = 'discovered' then 1
              when ${catalogCandidates.status} = 'quarantined' then 2
              else 3
            end,
            ${catalogCandidates.updatedAt} desc
          `,
          )
          .limit(args.limit)
      ).map((row) => row.id);

  if (candidateIds.length === 0) {
    console.log('[catalog:promote] no candidates to promote');
    return;
  }

  const startedAt = Date.now();
  const [run] = args.dryRun
    ? [{ id: null as string | null }]
    : await db
        .insert(catalogRuns)
        .values({
          kind: 'manual',
          status: 'running',
          stage: 'promote',
          maxNewPromotions: args.limit,
          maxLlmCalls: 0,
          checkpointJson: { candidateIds, updateExisting: args.updateExisting },
        })
        .returning({ id: catalogRuns.id });

  let created = 0;
  let updated = 0;
  let blocked = 0;

  try {
    for (const candidateId of candidateIds) {
      const result = await promoteCatalogCandidate(db, candidateId, {
        dryRun: args.dryRun,
        updateExisting: args.updateExisting,
      });
      if (result.action === 'created') created += 1;
      else if (result.action === 'updated') updated += 1;
      else if (result.action === 'blocked') blocked += 1;
      console.log(
        `[catalog:promote] candidate=${candidateId} action=${result.action} slug=${result.slug ?? 'n/a'} issues=${result.issues.map((i) => i.code).join(',') || 'none'}`,
      );
    }

    if (run?.id) {
      await db
        .update(catalogRuns)
        .set({
          status: 'success',
          stage: 'done',
          createdCount: created,
          updatedCount: updated,
          quarantinedCount: blocked,
          llmCallCount: 0,
          finishedAt: sql`now()`,
          durationMs: Date.now() - startedAt,
        })
        .where(eq(catalogRuns.id, run.id));
    }

    console.log(
      `[catalog:promote] done candidates=${candidateIds.length} created=${created} updated=${updated} blocked=${blocked} llm_calls=0`,
    );
  } catch (err) {
    if (run?.id) {
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
    }
    throw err;
  }
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:promote [options]',
      '',
      'Options:',
      '  --candidate <uuid>   Promote one candidate',
      '  --ready              Promote ready/revalidatable structured candidates',
      '  --limit N            Max ready candidates to process (default: 20)',
      '  --dry-run            Validate and print actions without DB writes',
      '  --update-existing    Refresh matched phones instead of blocking',
      '  --help               Print this message',
    ].join('\n'),
  );
}

function exitWithUsage(message: string): never {
  console.error(`[catalog:promote] ${message}\n`);
  printUsage();
  process.exit(2);
}

main().catch((err) => {
  console.error('[catalog:promote] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

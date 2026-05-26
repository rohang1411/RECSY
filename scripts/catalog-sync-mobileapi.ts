#!/usr/bin/env tsx
/**
 * Sync recent phones from MobileAPI.dev.
 *
 * This optional source uses a licensed structured API key and makes zero LLM
 * calls. It stages by-year results as catalog candidates and can promote only
 * the records that satisfy the strict `PhoneSpecSchema` promotion contract.
 *
 * Usage:
 *   MOBILEAPI_API_KEY=... pnpm catalog:sync-mobileapi --since-years 2 --dry-run
 *   MOBILEAPI_API_KEY=... pnpm catalog:sync-mobileapi --since-years 2 --promote
 */
import { and, eq, gte, inArray, sql } from 'drizzle-orm';

import {
  brandPriorityRank,
  buildCanonicalKey,
  buildPromotionPlan,
  fetchMobileApiDevicesByYear,
  hashJson,
  isMainstreamPriorityBrand,
  mainstreamPriorityBrandLabel,
  mobileApiDeviceToImportRecord,
  promoteCatalogCandidate,
  stableCandidateKey,
} from '../src/services/catalog';
import type { CatalogImportRecord } from '../src/services/catalog';
import { env } from '../src/env';
import { getDb } from '../src/services/db/client';
import { describeMissingSchema, findMissingPublicSchema } from '../src/services/db/schema-guard';
import { catalogCandidates, catalogRuns, catalogSourceProfiles } from '../src/services/db/schema';

const MOBILEAPI_SOURCE_KEY = 'mobileapi';
const MOBILEAPI_FREE_MONTHLY_REQUESTS = 50;
const MOBILEAPI_FREE_MIN_GAP_MS = 12_500;

interface CliArgs {
  readonly sinceYears: number;
  readonly years: readonly number[] | null;
  readonly limit: number;
  readonly maxPagesPerYear: number;
  readonly maxRequests: number;
  readonly minRequestGapMs: number;
  readonly dryRun: boolean;
  readonly promote: boolean;
  readonly updateExisting: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: {
    sinceYears: number;
    years: readonly number[] | null;
    limit: number;
    maxPagesPerYear: number;
    maxRequests: number;
    minRequestGapMs: number;
    dryRun: boolean;
    promote: boolean;
    updateExisting: boolean;
  } = {
    sinceYears: 2,
    years: null,
    limit: 150,
    maxPagesPerYear: 2,
    maxRequests: MOBILEAPI_FREE_MONTHLY_REQUESTS,
    minRequestGapMs: MOBILEAPI_FREE_MIN_GAP_MS,
    dryRun: false,
    promote: false,
    updateExisting: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    switch (flag) {
      case '--since-years':
        args.sinceYears = parsePositiveInt(argv[++i], '--since-years');
        break;
      case '--years':
        args.years = (argv[++i] ?? '')
          .split(',')
          .map((part) => Number(part.trim()))
          .filter((n) => Number.isInteger(n) && n > 2000);
        break;
      case '--limit':
        args.limit = parsePositiveInt(argv[++i], '--limit');
        break;
      case '--max-pages-per-year':
        args.maxPagesPerYear = parsePositiveInt(argv[++i], '--max-pages-per-year');
        break;
      case '--max-requests':
        args.maxRequests = parsePositiveInt(argv[++i], '--max-requests');
        break;
      case '--min-request-gap-ms':
        args.minRequestGapMs = parsePositiveInt(argv[++i], '--min-request-gap-ms');
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
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        exitWithUsage(`Unknown flag: ${flag}`);
    }
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = env.MOBILEAPI_API_KEY;
  if (!apiKey) {
    console.error(
      [
        '[catalog:sync-mobileapi] MOBILEAPI_API_KEY is not set.',
        '',
        'This command uses the optional licensed MobileAPI.dev source and cannot fetch without an API key.',
        '',
        'Options:',
        '  1. Add MOBILEAPI_API_KEY=<your key> to .env.local, then rerun this command.',
        '  2. Run the open no-key discovery path instead:',
        '     pnpm catalog:refresh --source wikidata --since-years 2 --limit 150',
        '  3. Import a trusted structured JSON export instead:',
        '     pnpm catalog:import-specs --file <path> --promote --update-existing',
        '',
        'LLM calls: 0',
      ].join('\n'),
    );
    process.exit(2);
  }

  const years = args.years ?? yearsFromSince(args.sinceYears);
  const db = getDb();
  const missing = await findMissingPublicSchema(db, [
    {
      table: 'catalog_runs',
      columns: ['stage', 'request_count', 'started_at'],
    },
    { table: 'catalog_source_profiles' },
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
    console.warn(describeMissingSchema('catalog:sync-mobileapi', missing));
    process.exit(0);
  }

  const [profile] = await db
    .select({
      monthlyRequestBudget: catalogSourceProfiles.monthlyRequestBudget,
      rateLimitMs: catalogSourceProfiles.rateLimitMs,
    })
    .from(catalogSourceProfiles)
    .where(eq(catalogSourceProfiles.sourceKey, MOBILEAPI_SOURCE_KEY))
    .limit(1);

  const monthlyBudget = Math.min(
    profile?.monthlyRequestBudget ?? MOBILEAPI_FREE_MONTHLY_REQUESTS,
    MOBILEAPI_FREE_MONTHLY_REQUESTS,
  );
  const usedThisMonth = await getMobileApiRequestsUsedThisMonth(db);
  const effectiveMaxRequests = Math.max(
    0,
    Math.min(args.maxRequests, monthlyBudget - usedThisMonth),
  );
  const minRequestGapMs = Math.max(
    args.minRequestGapMs,
    profile?.rateLimitMs ?? MOBILEAPI_FREE_MIN_GAP_MS,
    MOBILEAPI_FREE_MIN_GAP_MS,
  );

  if (effectiveMaxRequests <= 0) {
    console.log(
      `[catalog:sync-mobileapi] skipped: MobileAPI monthly budget exhausted used=${usedThisMonth} budget=${monthlyBudget} llm_calls=0`,
    );
    return;
  }

  if (effectiveMaxRequests < args.maxRequests) {
    console.log(
      `[catalog:sync-mobileapi] reducing request cap to ${effectiveMaxRequests}; MobileAPI monthly usage is ${usedThisMonth}/${monthlyBudget}`,
    );
  }

  const startedAt = Date.now();
  const run = args.dryRun
    ? null
    : (
        await db
          .insert(catalogRuns)
          .values({
            kind: 'manual',
            status: 'running',
            stage: args.promote ? 'mobileapi_promote' : 'mobileapi_stage',
            requestCount: 0,
            maxRequests: effectiveMaxRequests,
            maxNewPromotions: args.limit,
            maxLlmCalls: 0,
            checkpointJson: {
              sourceKey: MOBILEAPI_SOURCE_KEY,
              years,
              limit: args.limit,
              maxPagesPerYear: args.maxPagesPerYear,
              maxRequests: effectiveMaxRequests,
              monthlyBudget,
              monthlyRequestsUsedBeforeRun: usedThisMonth,
              minRequestGapMs,
            },
          })
          .returning({ id: catalogRuns.id })
      )[0];
  if (!args.dryRun && !run) throw new Error('catalog run insert returned no row');

  let created = 0;
  let updated = 0;
  let promoted = 0;
  let quarantined = 0;
  let requests = 0;

  try {
    const records = await fetchRecords({
      apiKey,
      years,
      limit: args.limit,
      maxPagesPerYear: args.maxPagesPerYear,
      maxRequests: effectiveMaxRequests,
      minRequestGapMs,
      onRequest: async (requestCount) => {
        requests = requestCount;
        if (run) {
          await db
            .update(catalogRuns)
            .set({
              requestCount,
              checkpointJson: sql`jsonb_set(${catalogRuns.checkpointJson}, '{lastRequestAt}', to_jsonb(now()))`,
            })
            .where(eq(catalogRuns.id, run.id));
        }
      },
    });

    const selection = selectPlansForLimit(records, args.limit);
    const planned = selection.planned;
    const valid = planned.filter((item) => item.plan.ok).length;
    const blocked = planned.length - valid;

    if (args.dryRun) {
      console.log(
        `[catalog:sync-mobileapi] dry-run years=${years.join(',')} scanned=${selection.scanned} selected=${planned.length} valid=${valid} blocked=${blocked} mainstream_selected=${selection.mainstreamSelected} incomplete_scanned=${selection.incompleteScanned} unselected=${selection.unselected} requests=${requests} monthly_usage=${usedThisMonth + requests}/${monthlyBudget} llm_calls=0`,
      );
      console.log(`  priority_brands=${mainstreamPriorityBrandLabel()}`);
      for (const item of planned.slice(0, 20)) {
        const state = item.plan.ok
          ? 'valid'
          : `blocked:${item.plan.issues[0]?.code ?? 'unknown'} ${formatIssueSummary(item.plan.issues)}`;
        console.log(
          `  ${state} ${formatBrandPriority(item.record.brand)} ${item.record.brand} ${item.record.model}`,
        );
      }
      if (planned.length > 20) console.log(`  ... ${planned.length - 20} more`);
      return;
    }

    if (!run) throw new Error('catalog run insert returned no row');

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
          confidence: item.plan.ok ? '0.90' : '0.50',
          issueCodes: item.plan.ok ? [] : [...new Set(item.plan.issues.map((issue) => issue.code))],
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
            claimsJson: sql`
              case
                when excluded.status = 'quarantined'
                  and ${catalogCandidates.status} in ('ready_to_promote', 'promoted')
                then ${catalogCandidates.claimsJson}
                else excluded.claims_json
              end
            `,
            canonicalKey: sql`excluded.canonical_key`,
            contentHash: sql`
              case
                when excluded.status = 'quarantined'
                  and ${catalogCandidates.status} in ('ready_to_promote', 'promoted')
                then ${catalogCandidates.contentHash}
                else excluded.content_hash
              end
            `,
            decision: sql`
              case
                when excluded.status = 'quarantined'
                  and ${catalogCandidates.status} in ('ready_to_promote', 'promoted')
                then ${catalogCandidates.decision}
                else excluded.decision
              end
            `,
            status: sql`
              case
                when excluded.status = 'quarantined'
                  and ${catalogCandidates.status} in ('ready_to_promote', 'promoted')
                then ${catalogCandidates.status}
                else excluded.status
              end
            `,
            confidence: sql`
              case
                when excluded.status = 'quarantined'
                  and ${catalogCandidates.status} in ('ready_to_promote', 'promoted')
                then ${catalogCandidates.confidence}
                else excluded.confidence
              end
            `,
            issueCodes: sql`
              case
                when excluded.status = 'quarantined'
                  and ${catalogCandidates.status} in ('ready_to_promote', 'promoted')
                then ${catalogCandidates.issueCodes}
                else excluded.issue_codes
              end
            `,
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
      .update(catalogSourceProfiles)
      .set({ lastPolledAt: sql`now()`, lastSuccessfulAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(catalogSourceProfiles.sourceKey, MOBILEAPI_SOURCE_KEY));

    await db
      .update(catalogRuns)
      .set({
        status: 'success',
        stage: 'done',
        createdCount: created,
        updatedCount: updated,
        quarantinedCount: quarantined,
        requestCount: requests,
        llmCallCount: 0,
        finishedAt: sql`now()`,
        durationMs: Date.now() - startedAt,
      })
      .where(eq(catalogRuns.id, run.id));

    console.log(
      `[catalog:sync-mobileapi] done records=${planned.length} created=${created} updated=${updated} promoted=${promoted} quarantined=${quarantined} requests=${requests} monthly_usage=${usedThisMonth + requests}/${monthlyBudget} llm_calls=0`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (run) {
      await db
        .update(catalogRuns)
        .set({
          status: 'failed',
          requestCount: requests,
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

async function fetchRecords(args: {
  readonly apiKey: string;
  readonly years: readonly number[];
  readonly limit: number;
  readonly maxPagesPerYear: number;
  readonly maxRequests: number;
  readonly minRequestGapMs: number;
  readonly onRequest: (requestCount: number) => Promise<void>;
}): Promise<CatalogImportRecord[]> {
  const records: CatalogImportRecord[] = [];
  let requests = 0;

  for (const year of args.years) {
    for (
      let page = 1;
      page <= args.maxPagesPerYear && records.length < args.limit && requests < args.maxRequests;
      page++
    ) {
      if (requests > 0) {
        await sleep(args.minRequestGapMs);
      }
      const result = await fetchMobileApiDevicesByYear({ apiKey: args.apiKey, year, page });
      requests += 1;
      await args.onRequest(requests);
      records.push(...result.devices.map(mobileApiDeviceToImportRecord));
      if (!result.hasNext) break;
    }
    if (requests >= args.maxRequests || records.length >= args.limit) break;
  }

  return records;
}

async function getMobileApiRequestsUsedThisMonth(db: ReturnType<typeof getDb>): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [row] = await db
    .select({
      used: sql<number>`coalesce(sum(${catalogRuns.requestCount}), 0)::int`,
    })
    .from(catalogRuns)
    .where(
      and(
        gte(catalogRuns.startedAt, monthStart),
        inArray(catalogRuns.stage, ['mobileapi_stage', 'mobileapi_promote']),
      ),
    );
  return Number(row?.used ?? 0);
}

function stagePlan(record: CatalogImportRecord) {
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
}

function selectPlansForLimit(
  records: readonly CatalogImportRecord[],
  limit: number,
): {
  readonly planned: ReturnType<typeof stagePlan>[];
  readonly scanned: number;
  readonly mainstreamSelected: number;
  readonly incompleteScanned: number;
  readonly unselected: number;
} {
  const allPlans = records.map((record) => stagePlan(record)).sort(comparePlansForSelection);
  const blocked = allPlans.filter((item) => !item.plan.ok);
  const planned = allPlans.slice(0, limit);

  return {
    planned,
    scanned: allPlans.length,
    mainstreamSelected: planned.filter((item) => isMainstreamPriorityBrand(item.record.brand))
      .length,
    incompleteScanned: blocked.length,
    unselected: allPlans.length - planned.length,
  };
}

function comparePlansForSelection(
  a: ReturnType<typeof stagePlan>,
  b: ReturnType<typeof stagePlan>,
): number {
  if (a.plan.ok !== b.plan.ok) return a.plan.ok ? -1 : 1;
  const brandRank = brandPriorityRank(a.record.brand) - brandPriorityRank(b.record.brand);
  if (brandRank !== 0) return brandRank;
  const launchDateRank = compareLaunchDateDesc(a.record.launchDate, b.record.launchDate);
  if (launchDateRank !== 0) return launchDateRank;
  const completenessRank = b.plan.specCompleteness - a.plan.specCompleteness;
  if (completenessRank !== 0) return completenessRank;
  return `${a.record.brand} ${a.record.model}`.localeCompare(`${b.record.brand} ${b.record.model}`);
}

function compareLaunchDateDesc(a: string | undefined, b: string | undefined): number {
  const aTime = a ? Date.parse(a) : 0;
  const bTime = b ? Date.parse(b) : 0;
  return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
}

function formatBrandPriority(brand: string): string {
  const rank = brandPriorityRank(brand);
  return rank === Number.MAX_SAFE_INTEGER ? '[priority:later]' : `[priority:${rank}]`;
}

function formatIssueSummary(issues: readonly { fieldPath?: string; message: string }[]): string {
  const fields = [
    ...new Set(
      issues
        .map((issue) => issue.fieldPath)
        .filter((fieldPath): fieldPath is string => Boolean(fieldPath)),
    ),
  ];
  if (fields.length === 0) return '';
  const shown = fields.slice(0, 8).join(',');
  const suffix = fields.length > 8 ? `,+${fields.length - 8}` : '';
  return `missing=[${shown}${suffix}]`;
}

function yearsFromSince(sinceYears: number): number[] {
  const currentYear = new Date().getUTCFullYear();
  const startYear = currentYear - sinceYears;
  const years: number[] = [];
  for (let year = currentYear; year >= startYear; year--) years.push(year);
  return years;
}

function fallbackExternalId(record: CatalogImportRecord): string {
  return (
    record.slug ??
    buildCanonicalKey({
      brand: record.brand,
      model: record.model,
      launchDate: record.launchDate,
    })
  );
}

function parsePositiveInt(value: string | undefined, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) exitWithUsage(`Invalid ${flag}`);
  return parsed;
}

function printUsage(): void {
  console.log(
    [
      'Usage: pnpm catalog:sync-mobileapi [options]',
      '',
      'Options:',
      '  --since-years N          Include current year back through N years ago (default: 2)',
      '  --years 2026,2025        Explicit comma-separated years',
      '  --limit N                Max devices to stage (default: 150)',
      '  --max-pages-per-year N   MobileAPI pages per year (default: 2)',
      '  --max-requests N         Request cap for this run; monthly usage is also enforced (default: 50)',
      '  --min-request-gap-ms N    Delay between MobileAPI requests (default: 12500 = under 5/min)',
      '  --dry-run                Fetch and print summary without DB writes',
      '  --promote                Promote records that fully satisfy PhoneSpecSchema',
      '  --update-existing        Refresh matched phones instead of blocking',
      '  --help                   Print this message',
    ].join('\n'),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exitWithUsage(message: string): never {
  console.error(`[catalog:sync-mobileapi] ${message}\n`);
  printUsage();
  process.exit(2);
}

main().catch((err) => {
  console.error('[catalog:sync-mobileapi] FAILED');
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
});

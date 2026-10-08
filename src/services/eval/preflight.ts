import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ASPECT_NAMES } from '@/lib/constants';
import { env } from '@/env';
import type { AppDb } from '@/services/db/client';
import { getPostgres } from '@/services/db/client';
import { chunks, phones } from '@/services/db/schema';
import { loadRecommendationCatalog } from '@/services/recommender/catalog';
import type { GoldenBenchmarkDataset, MultiTurnTrajectoryFixture } from './types';

const nonempty = z.string().trim().min(1);
const positiveNumber = z.number().finite().nonnegative();
const persona = z
  .object({
    id: nonempty,
    name: nonempty,
    category: nonempty,
    userQuery: nonempty,
    requirements: z.object({
      budget_usd: z
        .object({ min: positiveNumber.optional(), max: positiveNumber.optional() })
        .optional(),
      priorities: z
        .array(z.object({ aspect: z.enum(ASPECT_NAMES), weight: positiveNumber }))
        .min(1),
      use_cases: z.array(nonempty),
      must_haves: z.array(nonempty),
      deal_breakers: z.array(nonempty),
      brand_preference: z.object({ liked: z.array(nonempty), disliked: z.array(nonempty) }),
      form_factor: z.enum(['standard', 'foldable', 'compact']).optional(),
    }),
    expectNoResults: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const budget = value.requirements.budget_usd;
    if (budget?.min != null && budget.max != null && budget.min > budget.max)
      ctx.addIssue({
        code: 'custom',
        path: ['requirements', 'budget_usd'],
        message: 'min exceeds max',
      });
    if (value.requirements.priorities.every((p) => p.weight === 0))
      ctx.addIssue({
        code: 'custom',
        path: ['requirements', 'priorities'],
        message: 'at least one weight must be positive',
      });
  });
const qaCase = z.object({
  id: nonempty,
  phoneSlug: nonempty,
  category: nonempty,
  query: nonempty,
  referenceFacts: z.array(nonempty).min(1),
  numericalEntities: z.array(nonempty).optional(),
});
const goldenSchema = z.object({
  version: nonempty,
  description: nonempty,
  recommenderPersonas: z.array(persona).min(1),
  attributedQaQueries: z.array(qaCase).min(1),
});
const trajectorySchema = z.object({
  trajectories: z
    .array(
      z.object({
        id: nonempty,
        name: nonempty,
        category: nonempty,
        description: nonempty,
        turns: z
          .array(
            z.object({
              turnIndex: z.number().int().positive(),
              userMessage: nonempty,
              expectedKind: z.enum(['results', 'clarify']).optional(),
              expectedSlots: z
                .object({
                  budgetMaxUsd: positiveNumber.nullable().optional(),
                  dislikedBrands: z.array(nonempty).optional(),
                  likedBrands: z.array(nonempty).optional(),
                  mustHaves: z.array(nonempty).optional(),
                  dealBreakers: z.array(nonempty).optional(),
                  formFactor: z.enum(['compact', 'foldable', 'standard']).optional(),
                  topAspect: z.enum(ASPECT_NAMES).optional(),
                })
                .strict()
                .optional(),
              forbiddenBrands: z.array(nonempty).optional(),
              forbiddenSlugs: z.array(nonempty).optional(),
              expectRefineIntent: z.boolean().optional(),
              isReset: z.boolean().optional(),
              mustPreservePriorSlots: z
                .array(z.enum(['budget', 'disliked_brands', 'platform', 'top_aspect']))
                .optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});
const unanswerableSchema = z.object({
  version: nonempty,
  description: nonempty,
  unanswerableQueries: z
    .array(
      z.object({
        id: nonempty,
        phoneSlug: nonempty,
        category: nonempty,
        query: nonempty,
        expectedAbstentionReason: nonempty,
      }),
    )
    .min(1),
});

export type EvaluationSuite = 'recsys' | 'rag' | 'load-stress' | 'multi-turn' | 'all';
export type ProviderTrack = 'stub' | 'live';

export class EvaluationPreflightError extends Error {
  constructor(
    readonly stage: string,
    message: string,
  ) {
    super(`${stage}: ${message}`);
    this.name = 'EvaluationPreflightError';
  }
}

function uniqueIds(items: readonly { id: string }[], file: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id))
      throw new EvaluationPreflightError('fixture', `${file}: duplicate id "${item.id}"`);
    seen.add(item.id);
  }
}

async function readValidated<T>(
  name: string,
  schema: z.ZodType<T>,
): Promise<{ data: T; sha256: string }> {
  const file = resolve(process.cwd(), 'fixtures', 'eval', name);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    throw new EvaluationPreflightError(
      'fixture',
      `${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new EvaluationPreflightError(
      'fixture',
      `${name}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new EvaluationPreflightError(
      'fixture',
      `${name} at ${first?.path.join('.') || '<root>'}: ${first?.message ?? 'invalid data'}`,
    );
  }
  return { data: parsed.data, sha256: createHash('sha256').update(raw).digest('hex') };
}

export async function loadEvaluationFixtures(): Promise<{
  golden: GoldenBenchmarkDataset;
  trajectories: MultiTurnTrajectoryFixture[];
  unanswerableCount: number;
  hashes: Record<string, string>;
}> {
  const [golden, trajectories, unanswerable] = await Promise.all([
    readValidated('golden-benchmark-dataset.json', goldenSchema),
    readValidated('multi-turn-trajectories.json', trajectorySchema),
    readValidated('qa-unanswerable-dataset.json', unanswerableSchema),
  ]);
  uniqueIds(golden.data.recommenderPersonas, 'golden-benchmark-dataset.json recommenderPersonas');
  uniqueIds(golden.data.attributedQaQueries, 'golden-benchmark-dataset.json attributedQaQueries');
  uniqueIds(trajectories.data.trajectories, 'multi-turn-trajectories.json trajectories');
  uniqueIds(
    unanswerable.data.unanswerableQueries,
    'qa-unanswerable-dataset.json unanswerableQueries',
  );
  for (const trajectory of trajectories.data.trajectories) {
    trajectory.turns.forEach((turn, index) => {
      if (turn.turnIndex !== index + 1)
        throw new EvaluationPreflightError(
          'fixture',
          `${trajectory.id}.turns[${index}].turnIndex: expected ${index + 1}, got ${turn.turnIndex}`,
        );
    });
  }
  return {
    golden: golden.data as GoldenBenchmarkDataset,
    trajectories: trajectories.data.trajectories as MultiTurnTrajectoryFixture[],
    unanswerableCount: unanswerable.data.unanswerableQueries.length,
    hashes: {
      'golden-benchmark-dataset.json': golden.sha256,
      'multi-turn-trajectories.json': trajectories.sha256,
      'qa-unanswerable-dataset.json': unanswerable.sha256,
    },
  };
}

export interface EvaluationPreflightReport {
  readonly fixtureHashes: Record<string, string>;
  readonly fixtureCounts: {
    personas: number;
    qa: number;
    trajectories: number;
    turns: number;
    quarantinedUnanswerable: number;
  };
  readonly catalogCount: number;
  readonly catalogSha256: string;
  readonly qaPhoneCount: number;
  readonly qaMissingPhones: readonly string[];
  readonly qaMissingCorpus: readonly string[];
  readonly loadTargetPhoneId: string | null;
  readonly loadTargetChunkCount: number;
}

export async function checkEvaluationReadiness(
  db: AppDb,
  suite: EvaluationSuite,
  sampleScale: 'quick' | 'full',
  providedFixtures?: Awaited<ReturnType<typeof loadEvaluationFixtures>>,
): Promise<EvaluationPreflightReport> {
  const fixtures = providedFixtures ?? (await loadEvaluationFixtures());
  const schemaRows = await getPostgres()`
    select table_name, column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = ${env.DATABASE_SCHEMA} and table_name in ('benchmark_runs', 'benchmark_results', 'recommendation_sessions', 'recommendation_clients')
  `;
  const columns = new Map(schemaRows.map((row) => [`${row.table_name}.${row.column_name}`, row]));
  for (const required of [
    'benchmark_runs.id',
    'benchmark_runs.config',
    'benchmark_results.run_id',
    'benchmark_results.trace_payload',
  ]) {
    if (!columns.has(required))
      throw new EvaluationPreflightError(
        'database schema',
        `missing ${required}; run the checked-in database migrations before evaluation`,
      );
  }
  if (suite === 'multi-turn' || suite === 'all') {
    for (const required of [
      'recommendation_clients.id',
      'recommendation_clients.client_token',
      'recommendation_sessions.client_id',
    ])
      if (!columns.has(required))
        throw new EvaluationPreflightError(
          'database schema',
          `missing ${required}; apply restored migration 0009 before session or multi-turn testing`,
        );
  }
  const catalog = await loadRecommendationCatalog(db, 'US');
  if (catalog.length === 0)
    throw new EvaluationPreflightError(
      'catalog',
      'no active US phones; load a real catalog before evaluation',
    );
  const catalogSha256 = createHash('sha256')
    .update(
      JSON.stringify(
        catalog
          .map((p) => ({
            id: p.phoneId,
            slug: p.slug,
            msrpUsd: p.msrpUsd,
            aspects: [...p.aspectScores],
          }))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
      ),
    )
    .digest('hex');
  const queries =
    sampleScale === 'quick'
      ? fixtures.golden.attributedQaQueries.slice(0, 5)
      : fixtures.golden.attributedQaQueries;
  const qaSlugs = [...new Set(queries.map((q) => q.phoneSlug))];
  const qaPhones = qaSlugs.length
    ? await db
        .select({ id: phones.id, slug: phones.slug })
        .from(phones)
        .where(inArray(phones.slug, qaSlugs))
    : [];
  const bySlug = new Map(qaPhones.map((p) => [p.slug, p.id]));
  const qaMissingPhones = qaSlugs.filter((slug) => !bySlug.has(slug));
  const targetIds = qaPhones.map((p) => p.id);
  const chunkRows = targetIds.length
    ? await db
        .select({ phoneId: chunks.phoneId })
        .from(chunks)
        .where(inArray(chunks.phoneId, targetIds))
    : [];
  const chunkCounts = new Map<string, number>();
  for (const row of chunkRows)
    chunkCounts.set(row.phoneId, (chunkCounts.get(row.phoneId) ?? 0) + 1);
  const qaMissingCorpus = qaSlugs.filter((slug) => {
    const id = bySlug.get(slug);
    return id != null && !chunkCounts.get(id);
  });

  let loadTargetPhoneId: string | null = null;
  let loadTargetChunkCount = 0;
  if (suite === 'load-stress') {
    const candidateIds = catalog.map((p) => p.phoneId);
    const rows = await db
      .select({ phoneId: chunks.phoneId })
      .from(chunks)
      .where(inArray(chunks.phoneId, candidateIds));
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.phoneId, (counts.get(row.phoneId) ?? 0) + 1);
    const top = [...counts].sort((a, b) => b[1] - a[1])[0];
    loadTargetPhoneId = top?.[0] ?? null;
    loadTargetChunkCount = top?.[1] ?? 0;
    if (!loadTargetPhoneId)
      throw new EvaluationPreflightError(
        'corpus',
        'no chunks exist for an active phone; retrieval load test would be a no-op',
      );
  }
  if ((suite === 'rag' || suite === 'all') && (qaMissingPhones.length || qaMissingCorpus.length)) {
    throw new EvaluationPreflightError(
      'corpus',
      `Q&A fixtures cannot run: missing phones [${qaMissingPhones.join(', ')}]; phones without chunks [${qaMissingCorpus.join(', ')}]. Ingest or revise the independently checked fixtures.`,
    );
  }
  return {
    fixtureHashes: fixtures.hashes,
    fixtureCounts: {
      personas: fixtures.golden.recommenderPersonas.length,
      qa: fixtures.golden.attributedQaQueries.length,
      trajectories: fixtures.trajectories.length,
      turns: fixtures.trajectories.reduce((n, t) => n + t.turns.length, 0),
      quarantinedUnanswerable: fixtures.unanswerableCount,
    },
    catalogCount: catalog.length,
    catalogSha256,
    qaPhoneCount: qaPhones.length,
    qaMissingPhones,
    qaMissingCorpus,
    loadTargetPhoneId,
    loadTargetChunkCount,
  };
}

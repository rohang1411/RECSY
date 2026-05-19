/**
 * Catalog candidate promotion.
 *
 * Purpose: safely turn a fully validated staged catalog candidate into a
 * canonical `phones` row plus identities, aliases, configurations, media, and
 * provenance. Routine promotion is deterministic and makes no LLM calls.
 *
 * Used by: `scripts/catalog-promote.ts` and tests.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';

import { PhoneSpecSchema, type PhoneSpec } from '@/features/phones/schema';
import type { AppDb } from '@/services/db/client';
import {
  catalogCandidates,
  catalogQualityIssues,
  catalogSourceClaims,
  phoneAliases,
  phoneConfigurations,
  phoneIdentities,
  phoneMediaAssets,
  phones,
} from '@/services/db/schema';

import { generateAliasCandidates } from './aliases';
import { buildCanonicalKey, buildPhoneSlug, canonicalizeUrl } from './identity';
import {
  CatalogPromotionClaimsSchema,
  type CatalogImportIdentity,
  type CatalogPromotionClaims,
} from './import-schema';
import { projectPhoneSpec, specCompleteness } from './spec-project';
import { sha256Hex } from './snapshots';
import { validateCatalogCandidate, type CatalogValidationIssue } from './validation';

type PromotionIdentity = CatalogImportIdentity;
type CatalogDb = Pick<AppDb, 'select' | 'insert' | 'update'>;

export interface PromotionPlanInput {
  readonly candidateId?: string | null;
  readonly sourceKey: string;
  readonly externalId?: string | null;
  readonly sourceUrl?: string | null;
  readonly canonicalKey?: string | null;
  readonly claimsJson: unknown;
}

export interface PromotionPlan {
  readonly ok: boolean;
  readonly claims?: CatalogPromotionClaims;
  readonly spec?: PhoneSpec;
  readonly slug?: string;
  readonly canonicalKey?: string;
  readonly specCompleteness: number;
  readonly identities: readonly PromotionIdentity[];
  readonly issues: readonly CatalogValidationIssue[];
}

export interface PromoteCandidateResult {
  readonly action: 'created' | 'updated' | 'blocked' | 'dry_run';
  readonly phoneId?: string;
  readonly slug?: string;
  readonly issues: readonly CatalogValidationIssue[];
  readonly aliasesInserted: number;
  readonly configurationsInserted: number;
  readonly mediaInserted: number;
}

export function buildPromotionPlan(input: PromotionPlanInput): PromotionPlan {
  const rawClaims = extractPromotionClaims(input.claimsJson);
  const parsed = CatalogPromotionClaimsSchema.safeParse(rawClaims);
  if (!parsed.success) {
    return {
      ok: false,
      specCompleteness: 0,
      identities: [],
      issues: parsed.error.issues.map((issue) => ({
        severity: 'blocker',
        code: 'invalid_promotion_claims',
        message: issue.message,
        fieldPath: issue.path.join('.'),
      })),
    };
  }

  const claims = parsed.data;
  const projection = projectPhoneSpec(claims.spec);
  const projectedSpec = projection.spec;
  const validationIssues = validateCatalogCandidate({
    brand: claims.brand,
    model: claims.model,
    launchDate: claims.launchDate,
    status: claims.status,
    sourceTier: claims.sourceTier,
    spec: claims.spec,
  });
  const issues: CatalogValidationIssue[] = [
    ...projection.missing.map((fieldPath) => ({
      severity: 'blocker' as const,
      code: 'missing_spec_field',
      message: `required PhoneSpec field missing: ${fieldPath}`,
      fieldPath,
    })),
    ...projection.issues.map((message) => ({
      severity: 'blocker' as const,
      code: 'invalid_phone_spec_projection',
      message,
    })),
    ...validationIssues.filter((issue) => issue.code !== 'missing_spec_field'),
  ];

  if (claims.sourceTier !== 'T0' && claims.sourceTier !== 'T2') {
    issues.push({
      severity: 'blocker',
      code: 'untrusted_promotion_source',
      message: 'auto-promotion requires official (T0) or licensed structured (T2) source data',
      fieldPath: 'sourceTier',
    });
  }

  const slug = claims.slug ?? buildPhoneSlug(claims.brand, claims.model);
  const canonicalKey =
    input.canonicalKey ??
    buildCanonicalKey({
      brand: claims.brand,
      model: claims.model,
      launchDate: claims.launchDate,
    });

  const identities = dedupeIdentities([
    ...claims.identities,
    {
      sourceKey: 'recsy_catalog',
      externalId: canonicalKey,
      identityType: 'canonical_key',
      confidence: 0.95,
    },
    ...(claims.officialUrl
      ? [
          {
            sourceKey: 'official',
            externalId: canonicalizeUrl(claims.officialUrl),
            identityType: 'official_url' as const,
            url: canonicalizeUrl(claims.officialUrl),
            confidence: 0.98,
          },
        ]
      : []),
    ...(input.externalId
      ? [
          {
            sourceKey: input.sourceKey,
            externalId: input.externalId,
            identityType: inferIdentityType(input.sourceKey),
            url: input.sourceUrl ?? undefined,
            confidence: input.sourceKey === 'wikidata' ? 0.95 : 0.9,
          },
        ]
      : []),
  ]);

  return {
    ok: issues.every((issue) => issue.severity !== 'blocker') && projectedSpec != null,
    claims,
    spec: projectedSpec,
    slug,
    canonicalKey,
    specCompleteness: specCompleteness(claims.spec),
    identities,
    issues,
  };
}

export async function promoteCatalogCandidate(
  db: AppDb,
  candidateId: string,
  opts: { dryRun?: boolean; updateExisting?: boolean } = {},
): Promise<PromoteCandidateResult> {
  const rows = await db
    .select({
      id: catalogCandidates.id,
      sourceKey: catalogCandidates.sourceKey,
      externalId: catalogCandidates.externalId,
      sourceUrl: catalogCandidates.sourceUrl,
      canonicalKey: catalogCandidates.canonicalKey,
      claimsJson: catalogCandidates.claimsJson,
    })
    .from(catalogCandidates)
    .where(eq(catalogCandidates.id, candidateId))
    .limit(1);
  const candidate = rows[0];
  if (!candidate) {
    throw new Error(`catalog candidate not found: ${candidateId}`);
  }

  const plan = buildPromotionPlan(candidate);
  if (!plan.ok || !plan.claims || !plan.spec || !plan.slug || !plan.canonicalKey) {
    if (!opts.dryRun) await writeCandidateIssues(db, candidateId, plan.issues);
    return {
      action: 'blocked',
      issues: plan.issues,
      aliasesInserted: 0,
      configurationsInserted: 0,
      mediaInserted: 0,
    };
  }

  const existingMatches = await findExistingPhoneMatches(db, {
    slug: plan.slug,
    canonicalKey: plan.canonicalKey,
    identities: plan.identities,
  });
  if (existingMatches.length > 1) {
    const issues: CatalogValidationIssue[] = [
      {
        severity: 'blocker',
        code: 'ambiguous_existing_match',
        message: `candidate matches multiple existing phones: ${existingMatches.join(', ')}`,
      },
    ];
    if (!opts.dryRun) await writeCandidateIssues(db, candidateId, issues);
    return {
      action: 'blocked',
      issues,
      aliasesInserted: 0,
      configurationsInserted: 0,
      mediaInserted: 0,
    };
  }

  if (opts.dryRun) {
    return {
      action: 'dry_run',
      phoneId: existingMatches[0],
      slug: plan.slug,
      issues: [],
      aliasesInserted: 0,
      configurationsInserted: 0,
      mediaInserted: 0,
    };
  }

  return db.transaction(async (tx) => {
    const existingPhoneId = existingMatches[0];
    if (existingPhoneId && !opts.updateExisting) {
      await tx
        .update(catalogCandidates)
        .set({
          matchedPhoneId: existingPhoneId,
          status: 'skipped',
          decision: 'matched_existing',
          issueCodes: ['matched_existing'],
          lastDecisionAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(catalogCandidates.id, candidateId));
      return {
        action: 'blocked',
        phoneId: existingPhoneId,
        slug: plan.slug,
        issues: [
          {
            severity: 'blocker',
            code: 'matched_existing',
            message: 'candidate matches an existing phone; rerun with --update-existing to refresh',
          },
        ],
        aliasesInserted: 0,
        configurationsInserted: 0,
        mediaInserted: 0,
      };
    }

    const phoneId =
      existingPhoneId ??
      (await tx.insert(phones).values(phoneInsertValues(plan)).returning({ id: phones.id }))[0]?.id;
    if (!phoneId) throw new Error('phone insert returned no row');

    if (existingPhoneId) {
      await tx
        .update(phones)
        .set({
          ...phoneUpdateValues(plan),
          updatedAt: sql`now()`,
        })
        .where(eq(phones.id, existingPhoneId));
    }

    await insertIdentities(tx, phoneId, plan.identities);
    const aliasCount = await insertAliases(tx, phoneId, plan);
    const configCount = await insertConfigurations(tx, phoneId, plan);
    const mediaCount = await insertMedia(tx, phoneId, plan);
    await insertPromotionClaims(tx, phoneId, candidateId, candidate, plan);

    await tx
      .update(catalogCandidates)
      .set({
        matchedPhoneId: phoneId,
        status: 'promoted',
        decision: existingPhoneId ? 'update_existing' : 'promote',
        confidence: '0.95',
        issueCodes: [],
        lastDecisionAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(eq(catalogCandidates.id, candidateId));

    return {
      action: existingPhoneId ? 'updated' : 'created',
      phoneId,
      slug: plan.slug,
      issues: [],
      aliasesInserted: aliasCount,
      configurationsInserted: configCount,
      mediaInserted: mediaCount,
    };
  });
}

function extractPromotionClaims(claimsJson: unknown): unknown {
  if (claimsJson && typeof claimsJson === 'object' && !Array.isArray(claimsJson)) {
    const record = claimsJson as Record<string, unknown>;
    return record.promotion ?? record;
  }
  return claimsJson;
}

function inferIdentityType(sourceKey: string): PromotionIdentity['identityType'] {
  if (sourceKey === 'wikidata') return 'wikidata_qid';
  if (sourceKey.includes('mobileapi')) return 'provider_id';
  if (sourceKey.includes('oem')) return 'oem_product_id';
  return 'provider_id';
}

function dedupeIdentities(identities: readonly PromotionIdentity[]): PromotionIdentity[] {
  const seen = new Set<string>();
  const out: PromotionIdentity[] = [];
  for (const identity of identities) {
    const key = `${identity.sourceKey}:${identity.externalId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(identity);
  }
  return out;
}

async function findExistingPhoneMatches(
  db: CatalogDb,
  input: {
    readonly slug: string;
    readonly canonicalKey: string;
    readonly identities: readonly PromotionIdentity[];
  },
): Promise<string[]> {
  const ids = new Set<string>();
  const slugRows = await db
    .select({ id: phones.id })
    .from(phones)
    .where(eq(phones.slug, input.slug));
  for (const row of slugRows) ids.add(row.id);

  const keyRows = await db
    .select({ id: phones.id })
    .from(phones)
    .where(eq(phones.canonicalKey, input.canonicalKey));
  for (const row of keyRows) ids.add(row.id);

  const identityExternalIds = input.identities.map((identity) => identity.externalId);
  if (identityExternalIds.length > 0) {
    const identityRows = await db
      .select({ phoneId: phoneIdentities.phoneId })
      .from(phoneIdentities)
      .where(inArray(phoneIdentities.externalId, identityExternalIds));
    for (const row of identityRows) ids.add(row.phoneId);
  }

  return [...ids];
}

function phoneInsertValues(plan: PromotionPlan) {
  if (!plan.claims || !plan.spec || !plan.slug || !plan.canonicalKey) {
    throw new Error('invalid promotion plan');
  }
  return {
    slug: plan.slug,
    brand: plan.claims.brand,
    model: plan.claims.model,
    tagline: plan.claims.tagline ?? null,
    launchDate: parseDateOrNull(plan.claims.launchDate),
    msrpUsd: normalizeMoney(plan.claims.msrpUsd),
    imageUrl: plan.claims.imageUrl ?? null,
    status: plan.claims.status,
    specJson: PhoneSpecSchema.parse(plan.spec) as unknown as Record<string, unknown>,
    specEmbedding: null,
    regionAvailability: plan.claims.regionAvailability,
    nextIngestAt: null,
    nextScorecardAt: null,
    canonicalKey: plan.canonicalKey,
    officialUrl: plan.claims.officialUrl ?? null,
    announcedAt: parseDateOrNull(plan.claims.announcedAt),
    releasedAt: parseDateOrNull(plan.claims.releasedAt ?? plan.claims.launchDate),
    catalogLastSeenAt: new Date(),
    lastCatalogRefreshAt: new Date(),
    metadataConfidence: '0.95',
    specCompleteness: plan.specCompleteness.toFixed(2),
    mediaStatus: plan.claims.imageUrl ? ('remote_only' as const) : ('missing' as const),
  };
}

function phoneUpdateValues(plan: PromotionPlan) {
  const values = phoneInsertValues(plan);
  return {
    brand: values.brand,
    model: values.model,
    tagline: values.tagline,
    launchDate: values.launchDate,
    msrpUsd: values.msrpUsd,
    imageUrl: values.imageUrl,
    status: values.status,
    specJson: values.specJson,
    specEmbedding: null,
    regionAvailability: values.regionAvailability,
    nextIngestAt: null,
    canonicalKey: values.canonicalKey,
    officialUrl: values.officialUrl,
    announcedAt: values.announcedAt,
    releasedAt: values.releasedAt,
    catalogLastSeenAt: values.catalogLastSeenAt,
    lastCatalogRefreshAt: values.lastCatalogRefreshAt,
    metadataConfidence: values.metadataConfidence,
    specCompleteness: values.specCompleteness,
    mediaStatus: values.mediaStatus,
  };
}

async function insertIdentities(
  tx: CatalogDb,
  phoneId: string,
  identities: readonly PromotionIdentity[],
): Promise<void> {
  for (const identity of identities) {
    await tx
      .insert(phoneIdentities)
      .values({
        phoneId,
        sourceKey: identity.sourceKey,
        externalId: identity.externalId,
        identityType: identity.identityType,
        url: identity.url ?? null,
        confidence: identity.confidence.toFixed(2),
      })
      .onConflictDoNothing();
  }
}

async function insertAliases(tx: CatalogDb, phoneId: string, plan: PromotionPlan): Promise<number> {
  if (!plan.claims || !plan.slug) return 0;
  const existingAliases = await tx
    .select({ alias: phoneAliases.alias, slug: phones.slug })
    .from(phoneAliases)
    .innerJoin(phones, eq(phones.id, phoneAliases.phoneId));
  const siblingRows = await tx
    .select({ model: phones.model })
    .from(phones)
    .where(and(eq(phones.brand, plan.claims.brand), eq(phones.status, 'active')));

  const generated = generateAliasCandidates({
    brand: plan.claims.brand,
    model: plan.claims.model,
    slug: plan.slug,
    labels: plan.claims.aliases,
    existingAliases,
    siblingModels: siblingRows.map((row) => row.model),
  });

  let inserted = 0;
  for (const alias of generated.accepted) {
    const result = await tx
      .insert(phoneAliases)
      .values({ phoneId, alias: alias.alias, priority: alias.priority })
      .onConflictDoNothing()
      .returning({ id: phoneAliases.id });
    inserted += result.length;
  }
  return inserted;
}

async function insertConfigurations(
  tx: CatalogDb,
  phoneId: string,
  plan: PromotionPlan,
): Promise<number> {
  if (!plan.claims) return 0;
  let inserted = 0;
  for (const config of plan.claims.configurations) {
    const result = await tx
      .insert(phoneConfigurations)
      .values({
        phoneId,
        region: config.region ?? null,
        modelNumber: config.modelNumber ?? null,
        sku: config.sku ?? null,
        gtin: config.gtin ?? null,
        ramGb: config.ramGb ?? null,
        storageGb: config.storageGb ?? null,
        color: config.color ?? null,
        networkVariant: config.networkVariant ?? null,
        marketVariant: config.marketVariant ?? null,
        simVariant: config.simVariant ?? null,
        priceAmount: normalizeMoney(config.priceAmount),
        priceCurrency: config.priceCurrency ?? null,
        availabilityStatus: config.availabilityStatus ?? null,
        sourceKey: config.sourceKey ?? plan.identities[0]?.sourceKey ?? null,
        sourceUrl: config.sourceUrl ?? null,
        confidence: config.confidence == null ? null : config.confidence.toFixed(2),
      })
      .onConflictDoNothing()
      .returning({ id: phoneConfigurations.id });
    inserted += result.length;
  }
  return inserted;
}

async function insertMedia(tx: CatalogDb, phoneId: string, plan: PromotionPlan): Promise<number> {
  const imageUrl = plan.claims?.imageUrl;
  if (!imageUrl) return 0;
  const result = await tx
    .insert(phoneMediaAssets)
    .values({
      phoneId,
      sourceKey: plan.identities[0]?.sourceKey ?? null,
      originUrl: imageUrl,
      publicUrl: imageUrl,
      sha256: sha256Hex(imageUrl),
      rightsStatus: 'remote_only',
      isPrimary: true,
      status: 'active',
      lastCheckedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: phoneMediaAssets.id });
  return result.length;
}

async function insertPromotionClaims(
  tx: CatalogDb,
  phoneId: string,
  candidateId: string,
  candidate: { sourceKey: string; sourceUrl: string | null; canonicalKey: string | null },
  plan: PromotionPlan,
): Promise<void> {
  if (!plan.claims || !plan.spec) return;
  const rows = [
    { fieldPath: 'identity.brand', value: plan.claims.brand },
    { fieldPath: 'identity.model', value: plan.claims.model },
    { fieldPath: 'identity.canonical_key', value: plan.canonicalKey },
    { fieldPath: 'spec_json', value: plan.spec },
    { fieldPath: 'promotion_claims', value: plan.claims },
  ];
  for (const row of rows) {
    await tx.insert(catalogSourceClaims).values({
      phoneId,
      candidateId,
      sourceKey: candidate.sourceKey,
      sourceUrl: candidate.sourceUrl,
      fieldPath: row.fieldPath,
      valueJson: row.value,
      confidence: '0.95',
      trustWeight: plan.claims.sourceTier === 'T0' ? '0.95' : '0.90',
      contentHash: candidate.canonicalKey ?? null,
      isCurrent: true,
    });
  }
}

async function writeCandidateIssues(
  db: CatalogDb,
  candidateId: string,
  issues: readonly CatalogValidationIssue[],
): Promise<void> {
  for (const issue of issues) {
    await db.insert(catalogQualityIssues).values({
      candidateId,
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      fieldPath: issue.fieldPath ?? null,
    });
  }
  await db
    .update(catalogCandidates)
    .set({
      status: 'quarantined',
      decision: 'quarantine',
      issueCodes: [...new Set(issues.map((issue) => issue.code))],
      lastDecisionAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(catalogCandidates.id, candidateId));
}

function parseDateOrNull(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeMoney(value: string | number | undefined): string | null {
  if (value == null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed.toFixed(2);
}

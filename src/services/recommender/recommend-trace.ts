import { inArray, eq } from 'drizzle-orm';
import { ASPECT_NAMES, type AspectName } from '@/lib/constants';
import type { AppQueryDb } from '@/services/db/client';
import { aspects, aspectDefinitions } from '@/services/db/schema';
import type { PhoneCatalogEntry } from './catalog';
import type { ScoredCandidate } from './match';
import type { UserRequirements } from './requirements-schema';

export interface AspectScoreTrace {
  readonly aspect: AspectName;
  readonly score: number;
  readonly weight: number;
  readonly contribution: number;
  readonly confidence: number;
  readonly summary?: string | null;
  readonly supportingQuotes: readonly {
    readonly excerpt: string;
    readonly sourceTitle?: string;
  }[];
  readonly dissentingQuotes: readonly {
    readonly excerpt: string;
    readonly sourceTitle?: string;
  }[];
}

export interface RecommendPickTrace {
  readonly overallScore: number;
  readonly rank: number;
  readonly formula: {
    readonly baseAspectScore: number;
    readonly specSemanticBonus: number;
    readonly brandBonus: number;
    readonly totalScore: number;
  };
  readonly funnel: {
    readonly catalogCount: number;
    readonly budgetEligibleCount: number;
    readonly specEligibleCount: number;
    readonly finalPicksCount: number;
  };
  readonly aspectBreakdown: readonly AspectScoreTrace[];
  readonly matchedMustHaves: readonly string[];
  readonly tradeoffs: readonly string[];
  readonly vsRunnerUp?: {
    readonly runnerUpName: string;
    readonly scoreDelta: number;
    readonly keyDifferentiator: string;
  };
}

export interface EnrichedApiPick {
  readonly phoneId: string;
  readonly slug: string;
  readonly brand: string;
  readonly model: string;
  readonly score: number;
  readonly summary: string;
  readonly msrpUsd: string | null;
  readonly localPrice: string | null;
  readonly localCurrency: string | null;
  readonly imageUrl: string | null;
  readonly trace?: RecommendPickTrace;
}

interface QuoteItem {
  readonly excerpt?: string;
  readonly quote?: string;
  readonly text?: string;
  readonly sourceTitle?: string;
}

function parseQuotes(raw: unknown): Array<{ excerpt: string; sourceTitle?: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ excerpt: string; sourceTitle?: string }> = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ excerpt: item.trim() });
    } else if (item && typeof item === 'object') {
      const q = item as QuoteItem;
      const text = q.excerpt || q.quote || q.text;
      if (typeof text === 'string' && text.trim()) {
        out.push({
          excerpt: text.trim(),
          sourceTitle: typeof q.sourceTitle === 'string' ? q.sourceTitle : undefined,
        });
      }
    }
  }
  return out;
}

export async function enrichPicksWithTrace(input: {
  readonly db: AppQueryDb;
  readonly candidates: readonly ScoredCandidate[];
  readonly catalog: readonly PhoneCatalogEntry[];
  readonly requirements: UserRequirements;
  readonly weights: ReadonlyMap<AspectName, number>;
  readonly funnel: {
    readonly catalogCount: number;
    readonly budgetEligibleCount: number;
    readonly specEligibleCount: number;
  };
}): Promise<EnrichedApiPick[]> {
  const { db, candidates, catalog, requirements, weights, funnel } = input;
  if (candidates.length === 0) return [];

  const phoneIds = candidates.map((c) => c.phoneId);
  const catalogMap = new Map(catalog.map((entry) => [entry.phoneId, entry]));

  // 1. Fetch aspect scorecard quotes for the winning picks
  const aspectQuoteMap = new Map<
    string,
    Map<
      AspectName,
      {
        summary: string | null;
        supporting: Array<{ excerpt: string; sourceTitle?: string }>;
        dissenting: Array<{ excerpt: string; sourceTitle?: string }>;
      }
    >
  >();

  try {
    const rows = await db
      .select({
        phoneId: aspects.phoneId,
        aspect: aspectDefinitions.aspect,
        summary: aspects.summary,
        supporting: aspects.supportingQuotes,
        dissenting: aspects.dissentingQuotes,
      })
      .from(aspects)
      .innerJoin(aspectDefinitions, eq(aspectDefinitions.id, aspects.aspectDefinitionId))
      .where(inArray(aspects.phoneId, phoneIds));

    for (const r of rows) {
      let pMap = aspectQuoteMap.get(r.phoneId);
      if (!pMap) {
        pMap = new Map();
        aspectQuoteMap.set(r.phoneId, pMap);
      }
      pMap.set(r.aspect as AspectName, {
        summary: r.summary,
        supporting: parseQuotes(r.supporting),
        dissenting: parseQuotes(r.dissenting),
      });
    }
  } catch {
    // Graceful fallback if database read fails or mock db is in use
  }

  // 2. Build enriched picks with trace
  const out: EnrichedApiPick[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    const entry = catalogMap.get(candidate.phoneId);
    const aspectScores = entry?.aspectScores ?? candidate.aspectScores ?? new Map();
    const aspectConfidences = entry?.aspectConfidences ?? candidate.aspectConfidences ?? new Map();

    const pQuotes = aspectQuoteMap.get(candidate.phoneId);

    // Compute aspect breakdown
    const aspectBreakdown: AspectScoreTrace[] = [];
    let weightedBaseSum = 0;

    for (const name of ASPECT_NAMES) {
      const score = aspectScores.get(name) ?? 5.0;
      const weight = weights.get(name) ?? 1 / ASPECT_NAMES.length;
      const confidence = aspectConfidences.get(name) ?? 0.8;
      const contribution = Math.round(score * weight * 100) / 100;
      weightedBaseSum += contribution;

      const q = pQuotes?.get(name);
      aspectBreakdown.push({
        aspect: name,
        score: Math.round(score * 10) / 10,
        weight: Math.round(weight * 100) / 100,
        contribution,
        confidence: Math.round(confidence * 100) / 100,
        summary: q?.summary ?? null,
        supportingQuotes: q?.supporting ?? [],
        dissentingQuotes: q?.dissenting ?? [],
      });
    }

    // Sort aspect breakdown by weight (highest priority first)
    aspectBreakdown.sort((a, b) => b.weight - a.weight);

    // Determine vsRunnerUp for Rank 1
    let vsRunnerUp: RecommendPickTrace['vsRunnerUp'] | undefined;
    if (i === 0 && candidates.length > 1) {
      const runnerUp = candidates[1]!;
      const delta = Math.round((candidate.score - runnerUp.score) * 100) / 100;
      const topAspect = aspectBreakdown[0];
      const differentiator =
        topAspect && topAspect.weight > 0.2
          ? `Scored higher on ${topAspect.aspect} (${topAspect.score}/10) for your primary priority.`
          : 'Better overall alignment across your stated budget and feature priorities.';

      vsRunnerUp = {
        runnerUpName: `${runnerUp.brand} ${runnerUp.model}`,
        scoreDelta: delta,
        keyDifferentiator: differentiator,
      };
    }

    const trace: RecommendPickTrace = {
      overallScore: Math.round(candidate.score * 100) / 100,
      rank: i + 1,
      formula: {
        baseAspectScore: Math.round(weightedBaseSum * 100) / 100,
        specSemanticBonus: Math.round((candidate.specSemanticBonus ?? 0) * 100) / 100,
        brandBonus: Math.round((candidate.brandBonus ?? 0) * 100) / 100,
        totalScore: Math.round(candidate.score * 100) / 100,
      },
      funnel: {
        catalogCount: funnel.catalogCount,
        budgetEligibleCount: funnel.budgetEligibleCount,
        specEligibleCount: funnel.specEligibleCount,
        finalPicksCount: candidates.length,
      },
      aspectBreakdown,
      matchedMustHaves: Array.isArray(requirements.must_haves) ? [...requirements.must_haves] : [],
      tradeoffs: Array.isArray(requirements.deal_breakers) ? [...requirements.deal_breakers] : [],
      vsRunnerUp,
    };

    out.push({
      phoneId: candidate.phoneId,
      slug: candidate.slug,
      brand: candidate.brand,
      model: candidate.model,
      score: Math.round(candidate.score * 100) / 100,
      summary: candidate.summary,
      msrpUsd: candidate.msrpUsd,
      localPrice: candidate.localPrice ?? null,
      localCurrency: candidate.localCurrency ?? null,
      imageUrl: candidate.imageUrl,
      trace,
    });
  }

  return out;
}

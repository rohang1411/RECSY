/**
 * Aspect scorecard agent — Phase 4. Retrieves passages, asks the LLM for a
 * structured score + evidence, validates chunk ids, upserts `aspects`.
 */
import type { Logger } from 'pino';

import { env } from '@/env';
import { ASPECT_NAMES, MMR_LAMBDA } from '@/lib/constants';
import type { AppDb } from '@/services/db/client';
import { aspectDefinitions, aspects, phones } from '@/services/db/schema';
import type { ChatMessage, LlmProvider } from '@/services/llm/types';
import type { HybridRetriever } from '@/services/retrieval/retriever';
import type { RetrievedChunk } from '@/services/retrieval/types';
import { eq, sql } from 'drizzle-orm';

import {
  SCORECARD_K_PER_RETRIEVER,
  SCORECARD_MIN_DISTINCT_SOURCES,
  SCORECARD_TARGET_RESULTS,
} from './constants';
import { latestAspectDefinitionsByAspect } from './definitions';
import {
  aspectScorecardExtractionSchema,
  type AspectScorecardExtraction,
} from './extraction-schema';
import { buildCombinedRetrievalQuery } from './query-build';
import { recencyConfidenceBoost } from './recency';
import type { AspectDefinitionRow, ScorecardQuote } from './types';

export interface ScorecardRunContext {
  readonly phoneId: string;
  readonly brand: string;
  readonly model: string;
  readonly db: AppDb;
  readonly retriever: HybridRetriever;
  readonly llm: LlmProvider;
  readonly log: Logger;
}

function chunkAllowList(chunks: readonly RetrievedChunk[]): ReadonlySet<string> {
  return new Set(chunks.map((c) => c.chunkId.toLowerCase()));
}

function validateEvidence(
  extraction: AspectScorecardExtraction,
  allowed: ReadonlySet<string>,
): readonly string[] {
  const bad: string[] = [];
  for (const item of [...extraction.supporting, ...extraction.dissenting]) {
    if (!allowed.has(item.chunkId.toLowerCase())) {
      bad.push(item.chunkId);
    }
  }
  return bad;
}

function stripInvalidEvidence(
  extraction: AspectScorecardExtraction,
  allowed: ReadonlySet<string>,
): AspectScorecardExtraction {
  return {
    ...extraction,
    supporting: extraction.supporting.filter((s) => allowed.has(s.chunkId.toLowerCase())),
    dissenting: extraction.dissenting.filter((s) => allowed.has(s.chunkId.toLowerCase())),
  };
}

function toQuotes(
  items: readonly { chunkId: string; excerpt: string }[],
  byChunk: ReadonlyMap<string, RetrievedChunk>,
): ScorecardQuote[] {
  return items.map((item) => {
    const ch = byChunk.get(item.chunkId.toLowerCase());
    return {
      chunkId: ch?.chunkId ?? item.chunkId,
      excerpt: item.excerpt,
      ...(ch?.source.title ? { sourceTitle: ch.source.title } : {}),
    };
  });
}

function distinctSourceCount(
  extraction: AspectScorecardExtraction,
  byChunk: ReadonlyMap<string, RetrievedChunk>,
): number {
  const ids = new Set<string>();
  for (const item of [...extraction.supporting, ...extraction.dissenting]) {
    const ch = byChunk.get(item.chunkId.toLowerCase());
    if (ch) ids.add(ch.sourceId);
  }
  return ids.size;
}

function formatScore(n: number): string {
  return Math.max(0, Math.min(10, n)).toFixed(1);
}

function formatConfidence(n: number): string {
  return Math.max(0, Math.min(1, n)).toFixed(2);
}

function buildChunkMap(chunks: readonly RetrievedChunk[]): Map<string, RetrievedChunk> {
  return new Map(chunks.map((c) => [c.chunkId.toLowerCase(), c]));
}

function buildExtractionMessages(input: {
  readonly brand: string;
  readonly model: string;
  readonly aspectDescription: string;
  readonly aspectKey: string;
  readonly chunks: readonly RetrievedChunk[];
  readonly retryInvalid?: readonly string[];
}): ChatMessage[] {
  const excerpts = input.chunks
    .map((c, i) => {
      const excerpt = c.text.replace(/\s+/g, ' ').trim().slice(0, 700);
      return `### ${i + 1}\nid=${c.chunkId}\nsource=${c.source.title}\nexcerpt=${excerpt}`;
    })
    .join('\n\n');

  const system = `You are RECSY's methodology reviewer. Score the ${input.aspectKey} aspect for ${input.brand} ${input.model} using ONLY the numbered excerpts. Output JSON matching the schema: overallScore 0-10, confidence 0-1, summary (≤900 chars), supporting and dissenting evidence arrays. Each evidence item must use a chunk id from the excerpts and a short excerpt quote. Be honest about trade-offs; include dissent when reviewers disagree.`;

  const userParts = [`ASPECT METHODOLOGY:\n${input.aspectDescription}`, `PASSAGES:\n${excerpts}`];
  if (input.retryInvalid?.length) {
    userParts.push(
      `INVALID_CHUNK_IDS_REMOVED: ${input.retryInvalid.join(', ')}. Do not cite these; only use ids from PASSAGES.`,
    );
  }

  return [
    { role: 'system', content: system },
    { role: 'user', content: userParts.join('\n\n') },
  ];
}

async function llmExtract(
  llm: LlmProvider,
  messages: readonly ChatMessage[],
): Promise<AspectScorecardExtraction> {
  const out = await llm.structured({
    model: env.LLM_CHAT_MODEL,
    messages,
    schema: aspectScorecardExtractionSchema,
    schemaName: 'AspectScorecard',
    schemaDescription: 'Consensus aspect score with grounded evidence chunk ids.',
    temperature: 0.2,
    maxOutputTokens: 2048,
  });
  return out.value;
}

export async function runSingleAspect(
  ctx: ScorecardRunContext,
  def: AspectDefinitionRow,
): Promise<void> {
  const log = ctx.log.child({ aspect: def.aspect, aspectDefinitionId: def.id });
  const query = buildCombinedRetrievalQuery(def.queryPrompts);

  const retrieval = await ctx.retriever.search({
    phoneId: ctx.phoneId,
    query,
    options: {
      kPerRetriever: SCORECARD_K_PER_RETRIEVER,
      targetResults: SCORECARD_TARGET_RESULTS,
      minDistinctSources: SCORECARD_MIN_DISTINCT_SOURCES,
      mmrLambda: MMR_LAMBDA,
      rerank: 'off',
    },
  });

  if (retrieval.chunks.length === 0) {
    log.info('no chunks; writing neutral aspect row');
    await upsertAspect(ctx, def.id, {
      score: '5.0',
      rawScore: '5.0',
      confidence: '0.15',
      nSources: 0,
      nSupporting: 0,
      nDissenting: 0,
      summary: 'Not enough ingested reviews to score this aspect yet.',
      supportingQuotes: [],
      dissentingQuotes: [],
    });
    return;
  }

  const allowed = chunkAllowList(retrieval.chunks);
  const byChunk = buildChunkMap(retrieval.chunks);

  let messages = buildExtractionMessages({
    brand: ctx.brand,
    model: ctx.model,
    aspectDescription: def.description,
    aspectKey: def.aspect,
    chunks: retrieval.chunks,
  });

  let extraction = await llmExtract(ctx.llm, messages);
  let invalid = validateEvidence(extraction, allowed);

  if (invalid.length > 0) {
    log.warn({ invalid }, 'first extraction had invalid chunk ids; retrying');
    messages = buildExtractionMessages({
      brand: ctx.brand,
      model: ctx.model,
      aspectDescription: def.description,
      aspectKey: def.aspect,
      chunks: retrieval.chunks,
      retryInvalid: invalid,
    });
    extraction = await llmExtract(ctx.llm, messages);
    invalid = validateEvidence(extraction, allowed);
  }

  if (invalid.length > 0) {
    log.warn({ invalid }, 'stripping invalid evidence after retry');
    extraction = stripInvalidEvidence(extraction, allowed);
  }

  const referencedChunks: RetrievedChunk[] = [];
  const seenChunk = new Set<string>();
  for (const item of [...extraction.supporting, ...extraction.dissenting]) {
    const key = item.chunkId.toLowerCase();
    const ch = byChunk.get(key);
    if (ch && !seenChunk.has(key)) {
      seenChunk.add(key);
      referencedChunks.push(ch);
    }
  }
  const boost = recencyConfidenceBoost(referencedChunks);
  const confidence = Math.min(1, extraction.confidence + boost);
  const rawScore = extraction.overallScore;
  const score = rawScore;

  const supportingQuotes = toQuotes(extraction.supporting, byChunk);
  const dissentingQuotes = toQuotes(extraction.dissenting, byChunk);
  const nSources = distinctSourceCount(extraction, byChunk);

  await upsertAspect(ctx, def.id, {
    score: formatScore(score),
    rawScore: formatScore(rawScore),
    confidence: formatConfidence(confidence),
    nSources,
    nSupporting: supportingQuotes.length,
    nDissenting: dissentingQuotes.length,
    summary: extraction.summary,
    supportingQuotes,
    dissentingQuotes,
  });

  log.info(
    { score: formatScore(score), confidence: formatConfidence(confidence) },
    'aspect upserted',
  );
}

async function upsertAspect(
  ctx: ScorecardRunContext,
  aspectDefinitionId: string,
  row: {
    readonly score: string;
    readonly rawScore: string;
    readonly confidence: string;
    readonly nSources: number;
    readonly nSupporting: number;
    readonly nDissenting: number;
    readonly summary: string;
    readonly supportingQuotes: ScorecardQuote[];
    readonly dissentingQuotes: ScorecardQuote[];
  },
): Promise<void> {
  await ctx.db
    .insert(aspects)
    .values({
      phoneId: ctx.phoneId,
      aspectDefinitionId,
      score: row.score,
      rawScore: row.rawScore,
      confidence: row.confidence,
      nSources: row.nSources,
      nSupporting: row.nSupporting,
      nDissenting: row.nDissenting,
      summary: row.summary,
      supportingQuotes: row.supportingQuotes,
      dissentingQuotes: row.dissentingQuotes,
    })
    .onConflictDoUpdate({
      target: [aspects.phoneId, aspects.aspectDefinitionId],
      set: {
        score: sql`excluded.score`,
        rawScore: sql`excluded.raw_score`,
        confidence: sql`excluded.confidence`,
        nSources: sql`excluded.n_sources`,
        nSupporting: sql`excluded.n_supporting`,
        nDissenting: sql`excluded.n_dissenting`,
        summary: sql`excluded.summary`,
        supportingQuotes: sql`excluded.supporting_quotes`,
        dissentingQuotes: sql`excluded.dissenting_quotes`,
        updatedAt: sql`now()`,
      },
    });
}

export async function runScorecardForPhone(ctx: ScorecardRunContext): Promise<{ updated: number }> {
  const rows = await ctx.db.select().from(aspectDefinitions);
  const latest = latestAspectDefinitionsByAspect(rows);
  let updated = 0;

  for (const name of ASPECT_NAMES) {
    const def = latest.get(name);
    if (!def) {
      ctx.log.warn({ aspect: name }, 'missing aspect_definition row');
      continue;
    }
    await runSingleAspect(ctx, def);
    updated += 1;
  }

  return { updated };
}

/** Load phone row by slug for CLI / scripts. */
export async function loadPhoneBySlug(
  db: AppDb,
  slug: string,
): Promise<{ id: string; brand: string; model: string; status: string } | null> {
  const [phone] = await db
    .select({
      id: phones.id,
      brand: phones.brand,
      model: phones.model,
      status: phones.status,
    })
    .from(phones)
    .where(eq(phones.slug, slug))
    .limit(1);

  if (!phone) return null;
  return phone;
}

/**
 * Curator — one LLM call per fetched source, after chunking but before
 * embedding. The Curator is the single most important guardrail against
 * junk entering `chunks`: it reads a representative slice of the source
 * and decides whether the whole source is worth embedding + keeping.
 *
 * Why source-level, not chunk-level:
 *   One source ~ 10 chunks. Chunk-level gating would 5× our LLM bill for
 *   marginal precision — hybrid retrieval + the aspect scorecard already
 *   do per-chunk relevance downstream. A source either "talks about this
 *   phone with enough depth" or it doesn't.
 *
 * Output is persisted to `sources.{relevance,quality,aspectsCovered,
 * sentimentSummary}` regardless of the keep/reject decision, so we can
 * audit false negatives from `ingest_runs` + `sources`.
 *
 * Caching:
 *   The underlying `CachedLlmProvider` hashes messages + schema name.
 *   The Curator passes a fingerprint-friendly input (title + first chunks
 *   + source metadata) so the same source hits cache on re-runs. No extra
 *   key work needed here.
 */
import { z } from 'zod';

import { env } from '@/env';
import { logger } from '@/services/logger';

import type { LlmProvider } from '../../llm/types';
import type { RawChunk, RawSource, SourceType } from '../types';

// Aspect vocabulary MUST match `aspect` enum in the DB schema.
const ASPECT_VALUES = [
  'camera',
  'battery',
  'performance',
  'display',
  'build',
  'software',
  'value',
] as const;

export const curatorVerdictSchema = z.object({
  keep: z
    .boolean()
    .describe('True if the source should be embedded and written to `chunks`. False => reject.'),
  relevance: z
    .number()
    .min(0)
    .max(1)
    .describe('0..1. How much of the content is about THIS phone specifically.'),
  quality: z
    .number()
    .min(0)
    .max(1)
    .describe(
      '0..1. Review depth: 0 = news blurb / rant / spec list, 1 = hands-on multi-aspect review.',
    ),
  aspectsCovered: z
    .array(z.enum(ASPECT_VALUES))
    .describe(
      'Subset of [camera,battery,performance,display,build,software,value] meaningfully covered.',
    ),
  sentimentSummary: z
    .enum(['positive', 'mixed', 'negative', 'neutral'])
    .describe('Overall stance of the source toward the phone.'),
  reason: z
    .string()
    .min(1)
    .max(400)
    .describe('One-sentence audit trail. Used for rejectedReason + weekly review.'),
});

export type CuratorVerdict = z.infer<typeof curatorVerdictSchema>;

export interface CuratorInput {
  readonly phone: {
    readonly slug: string;
    readonly brand: string;
    readonly model: string;
  };
  readonly sourceType: SourceType;
  readonly raw: RawSource;
  /** First 3 chunks provide enough signal without blowing the token budget. */
  readonly sampleChunks: readonly RawChunk[];
}

export interface CuratorDecisionOptions {
  /** Lower bound on `relevance` required to keep. Default 0.5. */
  readonly minRelevance?: number;
  /** Lower bound on `quality` required to keep. Default 0.4. */
  readonly minQuality?: number;
}

export interface CuratorDecision {
  readonly verdict: CuratorVerdict;
  readonly keep: boolean;
  readonly rejectedReason: string | null;
  readonly usage: { readonly tokensIn: number; readonly tokensOut: number };
  readonly cached: boolean;
}

export class CuratorAgent {
  private readonly log = logger.child({ component: 'ingest.agent.curator' });

  constructor(
    private readonly llm: LlmProvider,
    private readonly opts: CuratorDecisionOptions = {},
  ) {}

  async decide(input: CuratorInput): Promise<CuratorDecision> {
    const minRelevance = this.opts.minRelevance ?? 0.5;
    const minQuality = this.opts.minQuality ?? 0.4;

    const messages = buildMessages(input);
    let verdict: CuratorVerdict;
    let usage = { tokensIn: 0, tokensOut: 0 };
    let cached = false;
    try {
      const result = await this.llm.structured({
        model: env.LLM_CHAT_MODEL,
        messages,
        schema: curatorVerdictSchema,
        schemaName: 'CuratorVerdict',
        schemaDescription:
          'Gatekeeper verdict for ingesting a single external source about a specific phone.',
        temperature: 0,
        usageContext: {
          area: 'Ingestion',
          feature: 'Source curator',
          source: 'CuratorAgent',
          metadata: { sourceType: input.sourceType },
        },
      });
      verdict = result.value;
      usage = result.usage;
      cached = result.cached;
    } catch (err) {
      // Curator failure must NOT destroy the run — we downgrade to "keep"
      // with a logged warning so a flaky LLM doesn't starve the corpus.
      // The verdict is still written to sources (relevance = null).
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err), url: input.raw.candidate.url },
        'curator call failed; defaulting to keep (no enrichment)',
      );
      return {
        verdict: {
          keep: true,
          relevance: 0.5,
          quality: 0.5,
          aspectsCovered: [],
          sentimentSummary: 'neutral',
          reason: 'curator-error-default-keep',
        },
        keep: true,
        rejectedReason: null,
        usage,
        cached: false,
      };
    }

    const meetsThresholds = verdict.relevance >= minRelevance && verdict.quality >= minQuality;
    const keep = verdict.keep && meetsThresholds;
    const rejectedReason = keep
      ? null
      : !verdict.keep
        ? `curator:${truncate(verdict.reason, 180)}`
        : verdict.relevance < minRelevance
          ? `low-relevance:${verdict.relevance.toFixed(2)}`
          : `low-quality:${verdict.quality.toFixed(2)}`;

    this.log.info(
      {
        url: input.raw.candidate.url,
        keep,
        relevance: verdict.relevance,
        quality: verdict.quality,
        cached,
      },
      keep ? 'curator: keep' : 'curator: reject',
    );

    return { verdict, keep, rejectedReason, usage, cached };
  }
}

function buildMessages(input: CuratorInput): { role: 'system' | 'user'; content: string }[] {
  const { phone, sourceType, raw, sampleChunks } = input;
  const title = raw.candidate.title || '(no title)';
  const publishedAt = raw.candidate.publishedAt ?? 'unknown';
  const author = raw.candidate.author ?? 'unknown';
  const channel = raw.candidate.channel ?? 'unknown';
  const excerpt = sampleChunks
    .slice(0, 3)
    .map((c, i) => `--- chunk ${i} (${c.tokens} tokens) ---\n${truncate(c.text, 1_800)}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content:
        'You are the Curator for a smartphone review corpus. Your job is to gate ' +
        'EACH source: decide whether it is worth embedding and keeping, and tag ' +
        'it with metadata. Be strict on relevance — comparison videos that only ' +
        'tangentially mention the target phone should score low. Be fair on ' +
        'quality — 10-minute hands-on reviews rate high even when critical. ' +
        'Return ONE JSON object matching the schema. No markdown.',
    },
    {
      role: 'user',
      content: [
        `TARGET PHONE: ${phone.brand} ${phone.model} (slug: ${phone.slug})`,
        '',
        `SOURCE TYPE: ${sourceType}`,
        `TITLE: ${title}`,
        `CHANNEL/AUTHOR: ${channel} / ${author}`,
        `PUBLISHED: ${publishedAt}`,
        '',
        'CONTENT EXCERPT (first ~3 chunks):',
        excerpt,
        '',
        'Evaluate: is this source ABOUT the target phone (not just a passing ' +
          'mention), and does it carry signal worth adding to the corpus?',
      ].join('\n'),
    },
  ];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

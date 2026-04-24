/**
 * Disambiguator — picks the PRIMARY phone for a source when the heuristic
 * alias matcher returns two or more candidate phones.
 *
 * When is this invoked:
 *   Only when `matchAliases(title + description)` returns >= 2 distinct
 *   phones. Single-phone matches are authoritative; we skip the LLM to save
 *   tokens. This is enforced by the caller (Scheduler / orchestrator), not
 *   by the agent itself.
 *
 * What does it output:
 *   One `primary` phone and zero-or-more `secondary` phones. The caller
 *   writes one row per phone to `source_phone_links` with the appropriate
 *   `role`; `chunks.phone_id` is denormalised to the primary.
 *
 * Failure mode:
 *   If the LLM call fails, we fall back to the heuristic's top-ranked match
 *   (longest alias + priority). That matches the current behaviour for
 *   non-ambiguous cases and keeps the pipeline moving.
 */
import { z } from 'zod';

import { env } from '@/env';
import { logger } from '@/services/logger';

import type { LlmProvider } from '../../llm/types';
import type { SourceType } from '../types';
import type { AliasMatch } from './alias-match';

export const disambiguatorResultSchema = z.object({
  primarySlug: z
    .string()
    .min(1)
    .describe(
      'Slug of the phone that is the PRIMARY subject of the content. Must be one of the candidates.',
    ),
  primaryConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe('0..1. How confident the model is that this phone is the primary subject.'),
  secondary: z
    .array(
      z.object({
        slug: z.string().min(1),
        relevance: z
          .number()
          .min(0)
          .max(1)
          .describe(
            'How much of the content is about this secondary phone (0..1). ' +
              'Use >=0.3 for comparison videos where it gets real screen time.',
          ),
      }),
    )
    .max(4)
    .describe('Other candidate phones mentioned with non-trivial content.'),
  reason: z.string().min(1).max(300),
});

export type DisambiguatorResult = z.infer<typeof disambiguatorResultSchema>;

export interface DisambiguatorInput {
  readonly sourceType: SourceType;
  readonly title: string;
  readonly description?: string | null;
  readonly channel?: string | null;
  readonly author?: string | null;
  /** Heuristic alias matches — MUST have length >= 2. */
  readonly candidates: readonly AliasMatch[];
}

export interface DisambiguatorDecision {
  readonly primary: AliasMatch;
  readonly primaryConfidence: number;
  readonly secondary: Array<{ match: AliasMatch; relevance: number }>;
  readonly reason: string;
  readonly fallback: boolean;
}

export class DisambiguatorAgent {
  private readonly log = logger.child({ component: 'ingest.agent.disambiguator' });

  constructor(private readonly llm: LlmProvider) {}

  async resolve(input: DisambiguatorInput): Promise<DisambiguatorDecision> {
    if (input.candidates.length < 2) {
      throw new Error(
        `DisambiguatorAgent.resolve requires >= 2 candidates; got ${input.candidates.length}`,
      );
    }

    const bySlug = new Map(input.candidates.map((c) => [c.slug, c]));

    const messages = buildMessages(input);

    try {
      const result = await this.llm.structured({
        model: env.LLM_CHAT_MODEL,
        messages,
        schema: disambiguatorResultSchema,
        schemaName: 'DisambiguatorResult',
        schemaDescription:
          'Selects the primary phone subject of a multi-phone source and lists secondaries.',
        temperature: 0,
      });
      const verdict = result.value;

      const primary = bySlug.get(verdict.primarySlug);
      if (!primary) {
        this.log.warn(
          { chosen: verdict.primarySlug, candidates: [...bySlug.keys()] },
          'disambiguator returned slug not in candidate set; falling back',
        );
        return this.fallback(input, 'llm-returned-unknown-slug');
      }

      const secondary: Array<{ match: AliasMatch; relevance: number }> = [];
      for (const s of verdict.secondary) {
        if (s.slug === verdict.primarySlug) continue;
        const m = bySlug.get(s.slug);
        if (!m) continue;
        secondary.push({ match: m, relevance: s.relevance });
      }

      this.log.info(
        {
          primary: primary.slug,
          secondaries: secondary.map((s) => s.match.slug),
          confidence: verdict.primaryConfidence,
        },
        'disambiguator resolved',
      );

      return {
        primary,
        primaryConfidence: verdict.primaryConfidence,
        secondary,
        reason: verdict.reason,
        fallback: false,
      };
    } catch (err) {
      this.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'disambiguator LLM call failed; falling back to heuristic',
      );
      return this.fallback(input, 'llm-error');
    }
  }

  private fallback(input: DisambiguatorInput, reason: string): DisambiguatorDecision {
    // Heuristic fallback: the first candidate is the heuristic-ranked best
    // match (matchAliases sorts by alias length + priority).
    const [primary, ...rest] = input.candidates;
    return {
      primary: primary!,
      primaryConfidence: 0.5,
      secondary: rest.map((m) => ({ match: m, relevance: 0.4 })),
      reason: `fallback:${reason}`,
      fallback: true,
    };
  }
}

function buildMessages(input: DisambiguatorInput): { role: 'system' | 'user'; content: string }[] {
  const candidateLines = input.candidates
    .map((c, i) => `  ${i + 1}. slug=${c.slug}  (matched alias: "${c.alias}")`)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        'You disambiguate which smartphone a piece of content is primarily about. ' +
        'Inputs: a title/description/channel + a shortlist of candidate phones that ' +
        'matched via alias heuristics. Choose ONE primary phone — the one that ' +
        'receives the most analysis/screen time. List others as secondary with a ' +
        'relevance score. Use ONLY slugs from the candidate shortlist. Return JSON.',
    },
    {
      role: 'user',
      content: [
        `SOURCE TYPE: ${input.sourceType}`,
        `TITLE: ${input.title}`,
        input.description ? `DESCRIPTION: ${truncate(input.description, 1_000)}` : null,
        input.channel ? `CHANNEL: ${input.channel}` : null,
        input.author ? `AUTHOR: ${input.author}` : null,
        '',
        'CANDIDATES:',
        candidateLines,
        '',
        'Decide which candidate is the PRIMARY subject. Output `primarySlug`, a ',
        '`primaryConfidence` in [0,1], and zero-or-more `secondary` entries with ',
        'relevance. Slugs MUST come from the candidate list.',
      ]
        .filter((x): x is string => x != null)
        .join('\n'),
    },
  ];
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

/**
 * Deterministic Mock LLM Provider for Data-Plane Concurrency Benchmarks.
 *
 * Implements LlmProvider without external SaaS API calls:
 *   - Generates 768-dimensional deterministic pseudo-embeddings from text hashes
 *   - Emits valid structured UserRequirements for recommender pipelines
 *   - Streams cited answer text for Q&A pipelines
 *   - Enables 1→100 VU stress testing of database and Node.js without hitting 429 rate limits
 */
import type {
  ChatDelta,
  ChatInput,
  ChatMessage,
  ChatResult,
  EmbedResult,
  LlmProvider,
  StructuredInput,
  StructuredResult,
} from '@/services/llm/types';

import {
  extractMessageFacts,
  mergeUserRequirements,
} from '@/services/recommender/requirements-merge';
import type { UserRequirements } from '@/services/recommender/requirements-schema';

export class DeterministicLlmProvider implements LlmProvider {
  readonly name = 'deterministic-mock-llm';

  async chat(input: ChatInput): Promise<ChatResult> {
    const text = this.synthesizeAnswer(input.messages);
    return {
      text,
      usage: { tokensIn: 100, tokensOut: 50 },
      model: 'deterministic-mock',
      cached: false,
    };
  }

  async *chatStream(input: ChatInput): AsyncIterable<ChatDelta> {
    const text = this.synthesizeAnswer(input.messages);
    const words = text.split(' ');
    for (const word of words) {
      yield {
        type: 'text-delta',
        textDelta: word + ' ',
      };
    }
    yield {
      type: 'finish',
      usage: { tokensIn: 100, tokensOut: words.length },
    };
  }

  async structured<T>(input: StructuredInput<T>): Promise<StructuredResult<T>> {
    // Inspect messages to construct realistic UserRequirements if requested
    const lastUserMsg =
      input.messages
        .slice()
        .reverse()
        .find((m) => m.role === 'user')?.content ?? '';

    let mockValue: unknown = {};

    // Check if the requested schema is UserRequirements
    if (input.schemaName.toLowerCase().includes('requirement')) {
      let previousState: UserRequirements | null = null;
      let rawUserMsg = lastUserMsg;

      const prevMatch = lastUserMsg.match(
        /PREVIOUS_STATE_JSON:\s*(\{[\s\S]*?\})\s*NEW_USER_MESSAGE:\s*([\s\S]*)/i,
      );
      if (prevMatch && prevMatch[1]) {
        try {
          previousState = JSON.parse(prevMatch[1]);
          rawUserMsg = prevMatch[2] ?? '';
        } catch {
          // ignore
        }
      } else {
        const singleMatch = lastUserMsg.match(/USER_MESSAGE:\s*([\s\S]*)/i);
        if (singleMatch && singleMatch[1]) {
          rawUserMsg = singleMatch[1];
        }
      }

      const trimmed = rawUserMsg.trim();
      const isUnderSpecified =
        trimmed.length < 35 &&
        !trimmed.includes('$') &&
        !/\b(?:budget|camera|battery|gaming|iphone|android|samsung|pixel|compact|foldable)\b/i.test(
          trimmed,
        );

      if (isUnderSpecified) {
        mockValue = {
          confidence: 0.3,
          clarifying_question:
            'What budget works for you, and what is your top priority (camera, battery, etc.)?',
          priorities: [],
          must_haves: [],
          deal_breakers: [],
          use_cases: [],
          brand_preference: { liked: [], disliked: [] },
        };
      } else {
        const facts = extractMessageFacts(rawUserMsg);
        const merged = mergeUserRequirements({
          previous: previousState,
          extracted: {
            confidence: 0.9,
            clarifying_question: undefined,
            budget_usd: facts.budgetUsd,
            priorities: facts.priorities,
            must_haves: [...facts.mustHaves],
            deal_breakers: [...facts.dealBreakers],
            use_cases: [...facts.useCases],
            brand_preference: {
              liked: [...facts.brandPreference.liked],
              disliked: [...facts.brandPreference.disliked],
            },
            form_factor: facts.formFactor,
          },
          userMessage: rawUserMsg,
        });

        mockValue = {
          confidence: 0.95,
          clarifying_question: undefined,
          budget_usd: merged.budget_usd,
          priorities: merged.priorities,
          must_haves: merged.must_haves,
          deal_breakers: merged.deal_breakers,
          use_cases: merged.use_cases,
          brand_preference: merged.brand_preference,
          form_factor: merged.form_factor,
        };
      }
    } else {
      mockValue = {};
    }

    const parsed = input.schema.safeParse(mockValue);
    const value = parsed.success ? parsed.data : (mockValue as T);

    return {
      value,
      usage: { tokensIn: 120, tokensOut: 60 },
      model: 'deterministic-mock',
      cached: false,
      attempts: 1,
    };
  }

  async embed(texts: readonly string[]): Promise<EmbedResult> {
    const embeddings = texts.map((t) => this.generateDeterministicVector(t, 768));
    return {
      embeddings,
      model: 'deterministic-mock-embed-768',
      usage: { tokensIn: texts.length * 10 },
    };
  }

  private generateDeterministicVector(text: string, dimensions = 768): number[] {
    // Generate deterministic 768-dim normalized vector via linear congruential PRNG from text hash
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }

    let seed = Math.abs(hash) || 12345;
    const vec: number[] = new Array(dimensions);
    let normSq = 0;

    for (let i = 0; i < dimensions; i++) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      const val = (seed / 4294967296) * 2 - 1; // [-1, 1]
      vec[i] = val;
      normSq += val * val;
    }

    // L2 normalize
    const norm = Math.sqrt(normSq) || 1;
    for (let i = 0; i < dimensions; i++) {
      vec[i] = (vec[i] ?? 0) / norm;
    }

    return vec;
  }

  private synthesizeAnswer(messages: readonly ChatMessage[]): string {
    // Find excerpt IDs in messages
    const fullText = messages.map((m) => m.content).join('\n');
    const chunkMatches = fullText.match(
      /id:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi,
    );

    if (chunkMatches && chunkMatches.length > 0) {
      const ids = chunkMatches.map((m) => m.replace(/id:\s*/i, '').trim());
      const c1 = ids[0];
      const c2 = ids[1] ?? ids[0];
      return `Based on verified reviews, the battery delivers solid all-day endurance lasting over 8 hours screen-on time [c:${c1}]. Charging reaches 50% in approximately 25 minutes using supported fast chargers [c:${c2}].`;
    }

    return 'The device delivers solid all-round performance with balanced battery life and responsive camera.';
  }
}

/**
 * LLM-powered Session Title Polish (Plan 27 Section 10.4).
 *
 * Runs asynchronously via deferOrRun on the first 'results' turn when
 * recommend_session_llm_titles flag is active.
 * Uses the cheapest chat model with strict token and time bounds.
 * Uses atomic compare-and-set so user renames are never overwritten.
 */
import { sql } from 'drizzle-orm';
import type { AppDb } from '@/services/db/client';
import { logger } from '@/services/logger';
import { getLlm } from '@/services/llm';
import type { LlmProvider } from '@/services/llm/types';
import type { UserRequirements } from './requirements-schema';
import { sanitizeSessionTitle } from './session-title';

const log = logger.child({ component: 'session-title-llm' });

export interface PolishTitleParams {
  sessionId: string;
  heuristicTitle: string;
  requirements: UserRequirements;
  llm?: LlmProvider;
}

export async function polishSessionTitleLlm(
  db: AppDb,
  params: PolishTitleParams,
): Promise<string | null> {
  const { sessionId, heuristicTitle, requirements } = params;
  const llm = params.llm ?? getLlm();

  // Create prompt from heuristic title and requirements (never raw user message)
  const reqSummary = {
    budget: requirements.budget_local ?? requirements.budget_usd ?? undefined,
    priorities: requirements.priorities.map((p) => p.aspect),
    brands: requirements.brand_preference.liked,
    mustHaves: requirements.must_haves,
  };

  const systemPrompt = `You generate concise, natural 2-to-5 word chat titles for phone shopping recommendations.
Rules:
- Output ONLY the title, no quotes, no explanations.
- Keep it between 2 and 6 words.
- Examples: "Camera Phone Under $700", "Compact Pixel With Long Battery", "Budget Gaming Phone Under ₹30,000", "Samsung Foldable".`;

  const userContent = `Draft title: "${heuristicTitle}"
Requirements: ${JSON.stringify(reqSummary)}
Refined title:`;

  try {
    const result = await llm.chat({
      model: 'gemini-2.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
      maxOutputTokens: 16,
      temperature: 0.2,
      signal: AbortSignal.timeout(4000),
      usageContext: {
        area: 'recommend:title',
      },
    });

    const candidate = sanitizeSessionTitle(result.text.trim());
    const words = candidate.split(/\s+/).filter(Boolean);

    // Validate 2-to-8 words
    if (words.length < 2 || words.length > 8) {
      log.warn(
        { candidate, wordCount: words.length },
        'llm title rejected: word count out of bounds',
      );
      return null;
    }

    // Atomic compare-and-set: update only if title_source is still 'heuristic'
    const updated = await db.execute<{ id: string }>(sql`
      UPDATE recommendation_sessions
         SET title = ${candidate},
             title_source = 'llm',
             updated_at = now()
       WHERE id = ${sessionId}::uuid
         AND title_source = 'heuristic'
      RETURNING id;
    `);

    if (updated.length === 0) {
      log.info({ sessionId }, 'llm title compare-and-set skipped: title_source was not heuristic');
      return null;
    }

    return candidate;
  } catch (err) {
    log.warn({ err, sessionId }, 'llm title polish failed or timed out; heuristic title preserved');
    return null;
  }
}

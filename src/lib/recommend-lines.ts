/**
 * Pure assistant lines builder for live and reopened recommendation turns (Plan 27 WP-08).
 *
 * Produces deterministic assistant text from a turn's stored or live fields
 * so that live turns and reopened historical turns render identical conversations.
 */

export interface PickAspectLike {
  brand?: string;
  model?: string;
  [key: string]: unknown;
}

export interface RecommendTurnLike {
  intent?: string | null;
  kind?: string | null;
  clarifyingQuestion?: string | null;
  picks?: unknown[] | null;
  relaxed?: string[] | null;
  refined?: boolean | null;
  scoresTied?: boolean | null;
  scorecardMissing?: boolean | null;
  topAspects?: string[] | null;
  resultMeta?: {
    relaxed?: string[];
    refined?: boolean;
    scoresTied?: boolean;
    scorecardMissing?: boolean;
    topAspects?: string[];
    [key: string]: unknown;
  } | null;
}

/**
 * Builds the assistant chat lines for a given recommendation turn.
 */
export function buildAssistantLines(turn: RecommendTurnLike): string[] {
  const intent = turn.intent || turn.kind || 'results';

  if (intent === 'clarify') {
    return [turn.clarifyingQuestion || 'Tell me a bit more about what you need.'];
  }

  const picks = (Array.isArray(turn.picks) ? turn.picks : []) as PickAspectLike[];
  const meta = turn.resultMeta || {};
  const relaxed = turn.relaxed ?? meta.relaxed ?? [];
  const refined = turn.refined ?? meta.refined ?? false;
  const scoresTied = turn.scoresTied ?? meta.scoresTied ?? false;
  const scorecardMissing = turn.scorecardMissing ?? meta.scorecardMissing ?? false;
  const topAspects = turn.topAspects ?? meta.topAspects ?? [];

  if (picks.length === 0) {
    return [
      'No catalog entries matched those preferences. Try relaxing one must-have or changing the budget, then ask again.',
    ];
  }

  const countLabel =
    picks.length === 1 ? 'one match' : picks.length === 2 ? 'two picks' : `top ${picks.length}`;

  const base = refined
    ? `Updated your recommendations. Returning ${countLabel}.`
    : `Recommendations are ready. Returning ${countLabel}.`;

  const intro = relaxed.length > 0 ? `${base} Adjusted: ${relaxed.join(', ')}.` : base;

  const lines: string[] = [intro];

  if (scoresTied && picks.length > 1) {
    const priorityHint =
      topAspects.length >= 2
        ? ` on ${topAspects[0]} and ${topAspects[1]}`
        : topAspects[0]
          ? ` on ${topAspects[0]}`
          : '';
    const topNames = picks
      .slice(0, 2)
      .map((p) => `${p.brand ?? ''} ${p.model ?? ''}`.trim())
      .filter(Boolean)
      .join(' and ');

    lines.push(
      `It's a tie between ${topNames || 'top picks'}${priorityHint}. Their performance across what you said matters is effectively identical, so both are presented side-by-side as top picks!`,
    );
  } else if (scorecardMissing && picks.length > 0) {
    lines.push(
      'No reviewer scorecard has been ingested yet, so this ranking is specs- and priorities-only.',
    );
  }

  return lines;
}

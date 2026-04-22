/**
 * Heuristic detector for "refine over the phones you already showed me"
 * follow-ups (e.g. "which of these is best for performance?", "rank them
 * for battery life", "ok between the top two which one?"). These messages
 * should re-rank the **prior turn's candidates only** — running a fresh
 * full-catalog search tends to return the same list and makes the recommender
 * feel broken. See ADR 0012.
 *
 * Intentionally conservative: we require (a) the session has a previous
 * `recommend` turn with picks, (b) the message is short and contains
 * refine-like language, and (c) the message does not introduce a new,
 * quantified hard constraint (e.g. "under $500", "rule out Samsung") that
 * clearly warrants a new search. A false positive is a worse UX than a
 * false negative, so we bias towards "treat as a new query".
 */

const REFINE_KEYWORDS: readonly RegExp[] = [
  /\bwhich (?:one|of (?:these|them|those|the|the three|the (?:top|best) \d+))\b/i,
  /\bof (?:these|them|those|the (?:three|\d+|above|top|previous))\b/i,
  /\bamong (?:these|them|those|the (?:three|\d+|above))\b/i,
  /\bbetween (?:these|them|those|the (?:two|three|\d+|top \d+))\b/i,
  /\brank(?:ed|ing)? (?:them|these|those|the (?:top|three|\d+))\b/i,
  /\b(?:best|better|top|worst) (?:one|pick|choice) (?:here|of (?:these|them|those))\b/i,
  /\b(?:compare|contrast) (?:them|these|those|the (?:top|three|\d+))\b/i,
  /\b(?:out of|from) (?:these|them|those|the (?:three|\d+|above))\b/i,
  /\b(?:the|your|these|those) (?:three|3|picks?|suggestions?|recommendations?|results?)\b/i,
  /\bof the (?:ones|phones) you (?:showed|listed|suggested|recommended|returned)\b/i,
];

/** Patterns that strongly indicate a fresh search, not a refinement. */
const NEW_QUERY_HINTS: readonly RegExp[] = [
  /\b(?:under|below|less than|cheaper than|max(?:imum)?|up to)\s*\$?\s*\d/i,
  /\b(?:over|above|more than|at least|min(?:imum)?)\s*\$?\s*\d/i,
  /\b(?:budget|price range)\b/i,
  /\b(?:instead|new|different|other|another) (?:phone|option|pick|recommendation|model|something|anything)s?\b/i,
  /\binstead of (?:these|them|those|that|the (?:three|\d+))\b/i,
  /\binstead[, ](?:something|anything|find|show|give)/i,
  /\b(?:show|give|find|recommend|suggest) (?:me )?(?:some|a|another|other|different|new)\b/i,
  /\bforget (?:these|them|those|that)\b/i,
  /\bstart (?:over|fresh|again)\b/i,
];

/** Short messages (< N chars) get a refine bonus. Longer messages usually carry new constraints. */
const SHORT_MESSAGE_MAX_CHARS = 180;

export interface RefineDetection {
  readonly refine: boolean;
  readonly matched: readonly string[];
  readonly rejected: readonly string[];
}

/**
 * Returns `{ refine: true }` when `message` looks like a refinement over the
 * previous recommend turn. Caller is responsible for checking that a previous
 * turn with picks actually exists; this function only inspects the message
 * text.
 */
export function detectRefineIntent(message: string): RefineDetection {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return { refine: false, matched: [], rejected: ['empty'] };
  }

  const rejected: string[] = [];
  for (const pat of NEW_QUERY_HINTS) {
    if (pat.test(trimmed)) rejected.push(pat.source);
  }
  if (rejected.length > 0) {
    return { refine: false, matched: [], rejected };
  }

  const matched: string[] = [];
  for (const pat of REFINE_KEYWORDS) {
    if (pat.test(trimmed)) matched.push(pat.source);
  }

  if (matched.length === 0) {
    return { refine: false, matched, rejected: ['no_refine_keyword'] };
  }

  if (trimmed.length > SHORT_MESSAGE_MAX_CHARS && matched.length < 2) {
    return { refine: false, matched, rejected: ['message_too_long_without_strong_signal'] };
  }

  return { refine: true, matched, rejected: [] };
}

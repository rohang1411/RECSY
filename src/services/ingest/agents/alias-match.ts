/**
 * Alias-based heuristic phone matching.
 *
 * Given a piece of text (video title, Reddit post title, article headline) and
 * a pool of known `phone_aliases`, find which phones are mentioned.
 *
 * Strategy:
 *   1. Normalise text to lowercase, collapse whitespace, strip most punctuation
 *      but keep `+` and digits intact (so "S25+" still matches).
 *   2. For each alias, check whether it appears as a word-boundary-safe
 *      substring of the normalised text.
 *   3. Collapse matches to one row per phone, keeping the longest matching
 *      alias (more specific beats more general: "Pixel 9 Pro XL" wins over
 *      "Pixel 9 Pro").
 *
 * When two or more DIFFERENT phones match, the caller is expected to invoke
 * the DisambiguatorAgent to pick the primary. When only one phone matches,
 * the heuristic alone is authoritative.
 */

export interface AliasRow {
  readonly phoneId: string;
  readonly slug: string;
  readonly alias: string;
  readonly priority: number;
}

export interface AliasMatch {
  readonly phoneId: string;
  readonly slug: string;
  /** The longest / highest-priority alias that hit. */
  readonly alias: string;
  readonly priority: number;
}

/** Lower-case + collapse whitespace, keep digits + `+`. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212]/g, '-') // unicode dashes → hyphen
    .replace(/[^a-z0-9+\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Word-boundary-aware substring match. We build a regex per alias but cache
 * the normalised alias string so callers matching many texts against the same
 * alias set don't pay repeated normalisation cost.
 */
function normaliseAlias(alias: string): string {
  return normaliseText(alias);
}

function boundaryRegex(normalisedAlias: string): RegExp {
  // Escape regex special chars; `+` must be literal.
  const escaped = normalisedAlias.replace(/[.*?^${}()|[\]\\]/g, '\\$&').replace(/\+/g, '\\+');
  // Surround with lookarounds so we match "s25 ultra" in "galaxy s25 ultra" but
  // not inside "s25ultra2" etc. We treat `-` and space as equivalent word
  // separators to handle "s25-ultra". Use a capturing group so we can read
  // the match position from `exec`.
  return new RegExp(`(?:^|[^a-z0-9+])(${escaped})(?=$|[^a-z0-9+])`, 'g');
}

export interface MatchOptions {
  /** Return at most this many distinct phones. Default 5. */
  readonly maxPhones?: number;
}

interface RawHit {
  row: AliasRow;
  normAlias: string;
  start: number;
  end: number;
}

/**
 * Returns one entry per distinct phone whose alias matched. Sorted by:
 *   1. longest alias first (specificity);
 *   2. then by `priority` desc (manual ordering);
 *   3. then by slug for stability.
 *
 * Longest-match-wins: if two aliases overlap in the text (e.g. "Galaxy S25"
 * inside "Galaxy S25 Ultra"), the shorter is suppressed. This prevents a
 * clean "S25 Ultra review" from looking like a comparison between S25 and
 * S25 Ultra.
 */
export function matchAliases(
  text: string,
  aliases: readonly AliasRow[],
  opts: MatchOptions = {},
): AliasMatch[] {
  const normalised = normaliseText(text);
  if (!normalised) return [];

  // Gather every hit (with position) for every alias.
  const hits: RawHit[] = [];
  for (const row of aliases) {
    const normAlias = normaliseAlias(row.alias);
    if (!normAlias) continue;
    if (!normalised.includes(normAlias)) continue;
    const re = boundaryRegex(normAlias);
    let m: RegExpExecArray | null;
    while ((m = re.exec(normalised)) != null) {
      const capturedStart = m.index + m[0].indexOf(m[1]!);
      hits.push({
        row,
        normAlias,
        start: capturedStart,
        end: capturedStart + normAlias.length,
      });
      // Guard against zero-length loop (shouldn't happen, but safe).
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  if (hits.length === 0) return [];

  // Suppress shorter hits that are fully contained in a longer hit from a
  // different phone. Sort by length desc so longer hits "claim" a span first.
  hits.sort((a, b) => b.normAlias.length - a.normAlias.length);
  const claimed: RawHit[] = [];
  const suppressed = new Set<RawHit>();
  for (const h of hits) {
    // If there's a strictly longer hit (different phone) whose span covers h,
    // suppress h. Same-phone hits are fine — they just confirm the match.
    const covered = claimed.find(
      (c) =>
        c.row.phoneId !== h.row.phoneId &&
        c.normAlias.length > h.normAlias.length &&
        c.start <= h.start &&
        c.end >= h.end,
    );
    if (covered) suppressed.add(h);
    else claimed.push(h);
  }

  // Map phoneId -> best surviving hit.
  const bestByPhone = new Map<string, RawHit>();
  for (const h of hits) {
    if (suppressed.has(h)) continue;
    const prior = bestByPhone.get(h.row.phoneId);
    if (!prior) {
      bestByPhone.set(h.row.phoneId, h);
      continue;
    }
    if (
      h.normAlias.length > prior.normAlias.length ||
      (h.normAlias.length === prior.normAlias.length && h.row.priority > prior.row.priority)
    ) {
      bestByPhone.set(h.row.phoneId, h);
    }
  }

  const matches: AliasMatch[] = [...bestByPhone.values()].map((h) => ({
    phoneId: h.row.phoneId,
    slug: h.row.slug,
    alias: h.row.alias,
    priority: h.row.priority,
  }));

  matches.sort((a, b) => {
    const aLen = normaliseAlias(a.alias).length;
    const bLen = normaliseAlias(b.alias).length;
    if (aLen !== bLen) return bLen - aLen;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.slug.localeCompare(b.slug);
  });

  const limit = opts.maxPhones ?? 5;
  return matches.slice(0, limit);
}

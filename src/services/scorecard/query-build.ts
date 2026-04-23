import { SCORECARD_COMBINED_QUERY_MAX_BYTES } from './constants';

/**
 * Collapse `query_prompts` into a single hybrid-retrieval query (one embed
 * per aspect). Truncated by UTF-8 bytes so FTS + Gemini stay bounded.
 */
export function buildCombinedRetrievalQuery(prompts: readonly string[]): string {
  const joined = prompts
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n');
  const enc = new TextEncoder();
  if (enc.encode(joined).length <= SCORECARD_COMBINED_QUERY_MAX_BYTES) {
    return joined;
  }
  let end = joined.length;
  while (end > 0 && enc.encode(joined.slice(0, end)).length > SCORECARD_COMBINED_QUERY_MAX_BYTES) {
    end -= 1;
  }
  return joined.slice(0, end).trimEnd();
}

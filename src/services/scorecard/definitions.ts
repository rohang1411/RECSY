/**
 * Aspect definition helpers — load and key the current scorecard schema.
 *
 * `latestAspectDefinitionsByAspect(db)` returns a `Map<AspectName, AspectDefinitionRow>`
 * for the most recent version of each aspect axis. This is the source of truth
 * for query prompts, extraction schemas, and aspect display names.
 *
 * Used by: `src/services/scorecard/agent.ts`,
 *          `src/services/recommender/run-recommendation.ts`.
 */
import type { AspectName } from '@/lib/constants';

import type { AspectDefinitionRow } from './types';

export type { AspectDefinitionRow };

/**
 * Keep the highest `version` row per `aspect` (canonical definitions for the
 * live scorecard agent).
 */
export function latestAspectDefinitionsByAspect(
  rows: readonly AspectDefinitionRow[],
): Map<AspectName, AspectDefinitionRow> {
  const out = new Map<AspectName, AspectDefinitionRow>();
  for (const row of rows) {
    const cur = out.get(row.aspect as AspectName);
    if (!cur || row.version > cur.version) {
      out.set(row.aspect as AspectName, row);
    }
  }
  return out;
}

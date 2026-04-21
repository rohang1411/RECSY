import type { RetrievedChunk } from '@/services/retrieval/types';

import { SCORECARD_RECENCY_WINDOW_MS } from './constants';

/**
 * Small additive confidence bump when evidence skews recent — does not alter
 * the headline 0–10 score (that stays the model's `overallScore`).
 */
export function recencyConfidenceBoost(chunks: readonly RetrievedChunk[]): number {
  const now = Date.now();
  let fresh = 0;
  let dated = 0;
  for (const c of chunks) {
    const t = c.source.publishedAt?.getTime();
    if (t == null || Number.isNaN(t)) continue;
    dated += 1;
    if (now - t <= SCORECARD_RECENCY_WINDOW_MS) fresh += 1;
  }
  if (dated === 0) return 0;
  const ratio = fresh / dated;
  return Math.min(0.12, ratio * 0.12);
}

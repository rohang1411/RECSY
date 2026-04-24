/**
 * Freshness tiering rules.
 *
 * A phone's "tier" is a function of how recently it launched:
 *   - hot  — launched in the last 60 days. Refresh 2×/week.
 *   - warm — launched in the last 12 months. Refresh weekly.
 *   - cold — older than 12 months. Refresh every 14 days.
 *
 * These are tunable from a single place so the scheduler, cron, and UI
 * share one definition.
 */
export type IngestTier = 'hot' | 'warm' | 'cold';

export const HOT_MAX_AGE_DAYS = 60;
export const WARM_MAX_AGE_DAYS = 365;

/** Minutes-after-midnight-UTC cadence per tier. */
export const REFRESH_INTERVAL_DAYS: Record<IngestTier, number> = {
  hot: 3.5, // ~twice per week
  warm: 7,
  cold: 14,
};

export function classifyTier(launchDate: Date | string | null | undefined): IngestTier {
  if (!launchDate) return 'cold';
  const launched = launchDate instanceof Date ? launchDate : new Date(launchDate);
  if (Number.isNaN(launched.getTime())) return 'cold';
  const ageDays = (Date.now() - launched.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= HOT_MAX_AGE_DAYS) return 'hot';
  if (ageDays <= WARM_MAX_AGE_DAYS) return 'warm';
  return 'cold';
}

/** Compute the next scheduled ingestion timestamp for a phone in `tier`. */
export function computeNextIngestAt(tier: IngestTier, from: Date = new Date()): Date {
  const days = REFRESH_INTERVAL_DAYS[tier];
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}

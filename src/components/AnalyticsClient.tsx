'use client';

import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/next';

/**
 * Vercel Analytics + Speed Insights. Safe on non-Vercel hosts (no-ops with no
 * configuration); see ADR 0010.
 */
export function AnalyticsClient() {
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}

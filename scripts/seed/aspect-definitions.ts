/**
 * Seed data for the `aspect_definitions` table.
 *
 * Aspects are the 7 canonical evaluation axes RECSY scores every phone on.
 * Storing them as data (not code) means:
 *   - Adding / retiring aspects is a SQL migration, not a codebase change.
 *   - Retrieval prompts evolve independently of the TypeScript surface.
 *   - We can version aspects (`version` column) so recomputed scorecards
 *     don't retroactively mutate older rows.
 *
 * Weights must sum to 1.0 across all default weights (sanity-checked in the
 * smoke test).
 */
import type { AspectName } from '@/lib/constants';

export interface AspectDefinitionSeed {
  aspect: AspectName;
  version: number;
  description: string;
  /** Semantic queries the scorecard agent retrieves against. */
  queryPrompts: string[];
  defaultWeight: string; // numeric, stored as string to preserve precision
}

/** v1 — static, data-driven. Never hand-edit rows in the DB; edit this file. */
export const ASPECT_DEFINITION_SEEDS: readonly AspectDefinitionSeed[] = [
  {
    aspect: 'camera',
    version: 1,
    description:
      'Overall imaging quality across main, ultrawide, and telephoto: detail, dynamic range, colour science, low-light performance, and video stabilisation.',
    queryPrompts: [
      'camera quality and image processing',
      'low-light and night photography',
      'zoom and telephoto performance',
      'video recording quality and stabilisation',
      'portrait mode and bokeh rendering',
      'ultrawide and macro capabilities',
    ],
    defaultWeight: '0.20',
  },
  {
    aspect: 'battery',
    version: 1,
    description:
      'Real-world endurance (screen-on time, day-to-day usage, idle drain) and charging behaviour (wired watts, wireless, heat, longevity).',
    queryPrompts: [
      'battery life and screen-on time',
      'fast charging speed',
      'wireless charging and reverse charging',
      'battery drain during gaming or video',
      'heat management while charging',
      'battery health over time',
    ],
    defaultWeight: '0.18',
  },
  {
    aspect: 'performance',
    version: 1,
    description:
      'Everyday responsiveness, sustained performance under load (gaming, encoding), thermal throttling, and memory management.',
    queryPrompts: [
      'chipset and processor performance',
      'gaming performance and frame rates',
      'thermal throttling under sustained load',
      'RAM management and app switching',
      'benchmark scores and real-world speed',
    ],
    defaultWeight: '0.15',
  },
  {
    aspect: 'display',
    version: 1,
    description:
      'Panel quality (peak brightness, HDR, colour accuracy, resolution), refresh-rate behaviour, outdoor visibility, and bezel / notch design.',
    queryPrompts: [
      'display brightness and outdoor visibility',
      'colour accuracy and calibration',
      'refresh rate and motion handling',
      'HDR quality and peak brightness',
      'bezels and screen-to-body ratio',
      'display resolution and sharpness',
    ],
    defaultWeight: '0.14',
  },
  {
    aspect: 'build',
    version: 1,
    description:
      'Materials (metal, glass, plastic), in-hand feel, weight balance, IP rating, durability (drops, scratches), and port quality.',
    queryPrompts: [
      'build quality and materials',
      'in-hand feel and ergonomics',
      'IP rating and water resistance',
      'durability and drop resistance',
      'weight and balance',
    ],
    defaultWeight: '0.10',
  },
  {
    aspect: 'software',
    version: 1,
    description:
      'OS fluidity, bloat, AI features, update commitment (OS + security), UI consistency, and regional feature parity.',
    queryPrompts: [
      'software experience and UI smoothness',
      'bloatware and pre-installed apps',
      'update policy and security patches',
      'AI features and on-device intelligence',
      'software bugs and stability',
    ],
    defaultWeight: '0.13',
  },
  {
    aspect: 'value',
    version: 1,
    description:
      'Price-to-performance at launch and post-discount, vs. direct peers. Captures reviewer verdicts on whether the phone is worth its sticker.',
    queryPrompts: [
      'value for money at this price',
      'comparison to competitors in the same price range',
      'post-launch discounts and street price',
      'what you get for the money',
    ],
    defaultWeight: '0.10',
  },
] as const;

/** Invariant: default weights must sum to 1.0 (within a small epsilon). */
export function validateAspectSeedWeights(seeds: readonly AspectDefinitionSeed[]): void {
  const sum = seeds.reduce((acc, s) => acc + Number(s.defaultWeight), 0);
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(
      `Aspect default weights must sum to 1.0 (got ${sum.toFixed(3)}). Adjust values in aspect-definitions.ts.`,
    );
  }
}

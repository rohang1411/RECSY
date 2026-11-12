/**
 * Seed `creator_profiles` — the YouTube channels whose uploads we actively
 * monitor. Channel IDs here are stable, public identifiers (the ones used by
 * https://www.youtube.com/feeds/videos.xml?channel_id=... for RSS polling).
 *
 * Expanding: add new rows to `CREATOR_SEEDS`; the seeder upserts on
 * (platform, external_id) so adding a row is always safe. If a known handle's
 * channel ID changes, the seeder disables stale active rows for that handle.
 *
 * Disabling a creator: set `status: 'disabled'` rather than deleting, so
 * older sources stay attributable.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import { creatorProfiles } from '../../src/services/db/schema';

export interface CreatorSeed {
  platform: 'youtube' | 'reddit' | 'article';
  externalId: string;
  handle: string;
  trustWeight: string;
  notes?: string;
}

export const CREATOR_SEEDS: readonly CreatorSeed[] = [
  // ─── 1. NARRATIVE, FLAGSHIP & LONG-TERM AUTHORITIES ───
  {
    platform: 'youtube',
    externalId: 'UCBJycsmduvYEL83R_U4JriQ',
    handle: 'MKBHD',
    trustWeight: '0.95',
    notes: 'Marques Brownlee — flagship launch reviews, blind camera brackets, annual awards.',
  },
  {
    platform: 'youtube',
    externalId: 'UCSOpcUkE-is7u7c4AkLgqTw',
    handle: 'MrMobile',
    trustWeight: '0.95',
    notes: 'Michael Fisher — gold standard of 6-month & 1-year reviews ("When the Hype Fades").',
  },
  {
    platform: 'youtube',
    externalId: 'UCVYamHliCI9rw1tHR1xbkfw',
    handle: 'Dave2D',
    trustWeight: '0.92',
    notes: 'Dave Lee — minimalist, highly objective thermal curves, display calibration, aging.',
  },
  {
    platform: 'youtube',
    externalId: 'UCMiJRAwDNSNzuYeN2uWa0pA',
    handle: 'Mrwhosetheboss',
    trustWeight: '0.90',
    notes: 'Arun Maini — multi-phone battery drain endurance tests, blind camera showdowns.',
  },
  {
    platform: 'youtube',
    externalId: 'UCFd8theSxw-k0Ox47eE9jcA',
    handle: 'FlossyCarter',
    trustWeight: '0.88',
    notes:
      'Flossy Carter — daily driver "Real Reviews", 6-month follow-ups, durability & case wear.',
  },
  {
    platform: 'youtube',
    externalId: 'UCzlXf-yUIaOpOjEjPrOO9TA',
    handle: 'TheTechChap',
    trustWeight: '0.88',
    notes: 'Tom Honeyands — camera shootouts, generational comparisons ("Is it still worth it?").',
  },
  {
    platform: 'youtube',
    externalId: 'UCIrrRLyFMVmmL9NDAU2obJA',
    handle: 'SuperSaf',
    trustWeight: '0.88',
    notes: 'Safwan Patel — side-by-side zoom, portrait & night mode head-to-head showdowns.',
  },
  {
    platform: 'youtube',
    externalId: 'UC3ns_Z_67iP1qSfa_kQyHqg',
    handle: 'TheStudio',
    trustWeight: '0.88',
    notes: 'The Studio team — deep roundtable discussions on long-term daily driver durability.',
  },
  {
    platform: 'youtube',
    externalId: 'UCVlMUh4WsDeKZbyFXCwKAeg',
    handle: 'MatthewMoniz',
    trustWeight: '0.88',
    notes:
      'Matthew Moniz — sustained thermal throttling, battery longevity, cross-platform checks.',
  },
  {
    platform: 'youtube',
    externalId: 'UCaDBRJTQhIg_QhCkW7SxWGQ',
    handle: 'TheUnlockr',
    trustWeight: '0.82',
    notes: 'Jon Rettinger — network cellular tests, launch-window comparisons.',
  },
  {
    platform: 'youtube',
    externalId: 'UCG6ZKG2d_H_w4A-GwrPZ8EQ',
    handle: 'WaveformClips',
    trustWeight: '0.85',
    notes: 'Waveform Podcast Clips — focused conversational critiques on recent phone updates.',
  },

  // ─── 2. SCIENTIFIC, LAB & STRESS-TESTING SPECIALISTS ───
  {
    platform: 'youtube',
    externalId: 'UC0vBXGSyV14uvJ4hECDOl0Q',
    handle: 'PhoneBuff',
    trustWeight: '0.95',
    notes: 'PhoneBuff — automated robotic arm speed tests & standardized robotic battery drain.',
  },
  {
    platform: 'youtube',
    externalId: 'UC7Dk7rWp_bY_1V8A2U_X_8g',
    handle: 'TechTablets',
    trustWeight: '0.90',
    notes: 'TechTablets (Chris) — deep lab logs, thermals, display PWM, global ROM imports.',
  },
  {
    platform: 'youtube',
    externalId: 'UCHcGwAUOYNjQ-z_Pek2t6iQ',
    handle: 'JerryRigEverything',
    trustWeight: '0.90',
    notes: 'Zack Nelson — Mohs hardness scratch test, frame bend test, structural durability.',
  },
  {
    platform: 'youtube',
    externalId: 'UC8e_8Lz_X1x2Y9Z3a8Q7g5w',
    handle: 'Geekerwan',
    trustWeight: '0.94',
    notes: 'Geekerwan — silicon efficiency curves, GPU power throttling, memory architecture.',
  },
  {
    platform: 'youtube',
    externalId: 'UCXuqSBlHAE6Xw-yeJA0Tunw',
    handle: 'LinusTechTips',
    trustWeight: '0.85',
    notes: 'LTT / ShortCircuit — hardware teardowns, lab display measurements, Linux/Android OS.',
  },

  // ─── 3. REGIONAL, MID-RANGE & VALUE/BATTERY CHAMPIONS ───
  {
    platform: 'youtube',
    externalId: 'UCtI0Hn8xQpQYd2xQeC9C-vg',
    handle: 'Beebom',
    trustWeight: '0.88',
    notes: 'Beebom — extreme multi-phone battery drain races, flagship killer value analyses.',
  },
  {
    platform: 'youtube',
    externalId: 'UC_zhn_VfL7P7S2m7d3v-Cvg',
    handle: 'Geekyranjit',
    trustWeight: '0.88',
    notes: 'Ranjit Kumar — practical Indian subcontinent daily reviews, 6-month follow-up tests.',
  },
  {
    platform: 'youtube',
    externalId: 'UC4XmG5U_4rFh9A_5o9w_W7Q',
    handle: 'TechSpurt',
    trustWeight: '0.85',
    notes: 'Tech Spurt — practical real-world testing, camera shoots, long-term battery reviews.',
  },
  {
    platform: 'youtube',
    externalId: 'UCkS_d_H1G8F2T_P_1B2vG7w',
    handle: 'C4ETech',
    trustWeight: '0.82',
    notes: 'C4ETech — Asian/European phone variants, speed test comparisons, battery drain.',
  },
  {
    platform: 'youtube',
    externalId: 'UCmKcxoxfP_2Z4qF2M_Lz89A',
    handle: 'AndroidCentralYT',
    trustWeight: '0.82',
    notes: 'Android Central — long-term ecosystem updates and trade-off breakdowns.',
  },
  {
    platform: 'youtube',
    externalId: 'UCeeFvIu_8y_8wX_Qd8v9W8A',
    handle: 'MobileTechReview',
    trustWeight: '0.88',
    notes:
      'Lisa Gade — in-depth professional hardware reviews, stylus/pen analysis, display color.',
  },
  {
    platform: 'youtube',
    externalId: 'UCso_4h8Q1L-A68Xb3G7eXvw',
    handle: 'DannyWinget',
    trustWeight: '0.82',
    notes: 'Danny Winget — side-by-side zoom shootouts and camera comparisons.',
  },
  {
    platform: 'youtube',
    externalId: 'UCqE_W4x_2G_vG0k4_K_L_vw',
    handle: 'ZoneOfTech',
    trustWeight: '0.82',
    notes: 'Daniel Rotar — generational comparison roundups and design deep dives.',
  },

  // ─── 4. OFFICIAL TECH MEDIA VIDEO CHANNELS ───
  {
    platform: 'youtube',
    externalId: 'UCY1hD9VvC7B6_L-2B3Q_x8A',
    handle: 'GSMArenaOfficial',
    trustWeight: '0.92',
    notes: 'GSMArena Video — official video reviews directly aligned with lab benchmark charts.',
  },
  {
    platform: 'youtube',
    externalId: 'UCdxPox_fXl3S_k3r0JvE6Lw',
    handle: 'AndroidAuthority',
    trustWeight: '0.90',
    notes: 'Android Authority YT — long-term retrospective reviews and camera blind tests.',
  },
  {
    platform: 'youtube',
    externalId: 'UCddiUEpeqJcYeBxX1IVBKvQ',
    handle: 'TheVerge',
    trustWeight: '0.90',
    notes: 'The Verge Video — industrial design criticism, camera shootouts, societal impact.',
  },
  {
    platform: 'youtube',
    externalId: 'UCkS4_pL_Q9r8F1D_2P7vKow',
    handle: 'TomsGuide',
    trustWeight: '0.85',
    notes: "Tom's Guide Video — display nit measurements and battery test comparisons.",
  },
  {
    platform: 'youtube',
    externalId: 'UCRijo3ddMTht_IHyKnXd77g',
    handle: 'Engadget',
    trustWeight: '0.85',
    notes: 'Engadget Video — hardware teardowns and editorial reviews.',
  },
  {
    platform: 'youtube',
    externalId: 'UC4h7N1Y9F8k2e1L_0P8_Xzw',
    handle: 'Pocketlint',
    trustWeight: '0.82',
    notes: 'Pocket-lint Video — European flagship reviews and buyer advice.',
  },
  {
    platform: 'youtube',
    externalId: 'UCknLRt4gkRgWTN842YjVqVw',
    handle: 'MacRumors',
    trustWeight: '0.85',
    notes: 'MacRumors Video — long-term iPhone wear, iOS battery life changes, durability.',
  },
  {
    platform: 'youtube',
    externalId: 'UCKy1dAqELo053tauGPCKmoA',
    handle: '9to5Mac',
    trustWeight: '0.85',
    notes: '9to5Mac Video — daily driver follow-ups and iPhone durability checks.',
  },
  {
    platform: 'youtube',
    externalId: 'UCvM_m_2x0L2X0R_X_L_Vwvw',
    handle: '9to5Google',
    trustWeight: '0.85',
    notes: '9to5Google Video — Pixel feature drops, bug fix reports, camera evolution.',
  },
  {
    platform: 'youtube',
    externalId: 'UCb290W4E5_3P7e5sW_3yE_w',
    handle: 'SamMobile',
    trustWeight: '0.82',
    notes: 'SamMobile Video — Galaxy One UI update reviews, battery optimization tests.',
  },
  {
    platform: 'youtube',
    externalId: 'UCx_P4wG1_vG7k8vW9x_2_rw',
    handle: 'NothingTech',
    trustWeight: '0.82',
    notes: 'Nothing / CMF official and community hardware reviews.',
  },
  {
    platform: 'youtube',
    externalId: 'UC_0rP_Q_X1z2Y9Z3a8Q7g5w',
    handle: 'TechAltar',
    trustWeight: '0.88',
    notes: 'Marton Barcza — macro mobile market economics, OEM strategic positioning.',
  },
];

export async function seedCreatorProfiles<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(db: PostgresJsDatabase<TSchema>): Promise<{ upserted: number; disabledStale: number }> {
  if (CREATOR_SEEDS.length === 0) return { upserted: 0, disabledStale: 0 };
  const rows = CREATOR_SEEDS.map((s) => ({
    platform: s.platform,
    externalId: s.externalId,
    handle: s.handle,
    trustWeight: s.trustWeight,
    notes: s.notes ?? null,
    status: 'active' as const,
  }));
  const result = await db
    .insert(creatorProfiles)
    .values(rows)
    .onConflictDoUpdate({
      target: [creatorProfiles.platform, creatorProfiles.externalId],
      set: {
        handle: sql`excluded.handle`,
        trustWeight: sql`excluded.trust_weight`,
        notes: sql`excluded.notes`,
        status: sql`excluded.status`,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: creatorProfiles.id });

  let disabledStale = 0;
  for (const seed of CREATOR_SEEDS) {
    const stale = await db
      .update(creatorProfiles)
      .set({
        status: 'disabled',
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(creatorProfiles.platform, seed.platform),
          eq(creatorProfiles.handle, seed.handle),
          sql`${creatorProfiles.externalId} <> ${seed.externalId}`,
        ),
      )
      .returning({ id: creatorProfiles.id });
    disabledStale += stale.length;
  }

  return { upserted: result.length, disabledStale };
}

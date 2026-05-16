/**
 * Unit tests for spec-embedding text builders (`spec-embedding-text.ts`).
 *
 * Tests cover: `buildSpecDocumentForEmbedding` output format (used for
 * `phones.spec_embedding`), and `buildRecommenderQueryText` user-query
 * text used to find the most spec-similar phones. All pure.
 */
import { describe, expect, it } from 'vitest';

import { buildRecommenderQueryText, buildSpecDocumentForEmbedding } from './spec-embedding-text';
import { normalizeUserRequirements, userRequirementsSchema } from './requirements-schema';

describe('spec-embedding-text', () => {
  it('buildRecommenderQueryText falls back when empty', () => {
    const r = normalizeUserRequirements(
      userRequirementsSchema.parse({
        confidence: 0.8,
        priorities: [],
        must_haves: [],
        deal_breakers: [],
        use_cases: [],
        brand_preference: { liked: [], disliked: [] },
      }),
    );
    expect(buildRecommenderQueryText(r)).toContain('smartphone');
  });

  it('buildSpecDocumentForEmbedding includes brand and key specs', () => {
    const spec = {
      display: {
        size_in: 6.1,
        resolution: '1080x2400',
        refresh_rate_hz: 120,
        panel_type: 'OLED',
        features: [],
      },
      chipset: 'Q1',
      ram_gb: 8,
      storage_options_gb: [128],
      rear_cameras: [{ type: 'main' as const, mp: 50 }],
      front_camera: { mp: 12 },
      battery_mah: 5000,
      charging: { wired_w: 30, wireless_w: 15, reverse_wireless_w: 0 },
      weight_g: 190,
      os: 'Android',
      connectivity: { wifi: '7', bluetooth: '5.3', nfc: true },
      colors: [],
      foldable: false,
      highlights: ['Test highlight'],
    };
    const t = buildSpecDocumentForEmbedding({
      brand: 'Acme',
      model: 'Zed',
      tagline: 'Fast',
      spec,
    });
    expect(t).toMatch(/Acme/);
    expect(t).toMatch(/Zed/);
  });
});

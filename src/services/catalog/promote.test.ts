/**
 * Unit tests for catalog promotion planning.
 *
 * These tests cover the pure validation boundary before any DB writes happen.
 */
import { describe, expect, it } from 'vitest';

import { buildPromotionPlan } from './promote';

const COMPLETE_SPEC = {
  display: {
    size_in: 6.7,
    resolution: '2796x1290',
    refresh_rate_hz: 120,
    panel_type: 'OLED',
  },
  chipset: 'Example X1',
  ramGb: 8,
  storageOptionsGb: [128, 256],
  rearCameras: [{ type: 'main', mp: 50, ois: true }],
  frontCamera: { mp: 12 },
  batteryMah: 5000,
  charging: { wired_w: 45, wireless_w: 15 },
  weightG: 198,
  os: 'Android 16',
  connectivity: { wifi: 'Wi-Fi 7', bluetooth: '5.4', nfc: true },
  colors: ['Black'],
  foldable: false,
};

describe('buildPromotionPlan', () => {
  it('accepts a complete official or licensed promotion claim', () => {
    const plan = buildPromotionPlan({
      sourceKey: 'mobileapi',
      externalId: '123',
      sourceUrl: 'https://api.mobileapi.dev/devices/123/',
      claimsJson: {
        promotion: {
          sourceTier: 'T2',
          brand: 'Example',
          model: 'Phone Pro',
          launchDate: '2026-01-05',
          status: 'active',
          regionAvailability: ['US'],
          msrpUsd: '799.00',
          officialUrl: 'https://example.com/phone-pro',
          aliases: ['Example Phone Pro'],
          spec: COMPLETE_SPEC,
        },
      },
    });

    expect(plan.ok).toBe(true);
    expect(plan.slug).toBe('example-phone-pro');
    expect(plan.canonicalKey).toBe('example:phone-pro:2026');
    expect(plan.identities.map((identity) => identity.identityType)).toContain('provider_id');
    expect(plan.spec).toMatchObject({ chipset: 'Example X1', battery_mah: 5000 });
  });

  it('blocks incomplete or low-trust promotion claims', () => {
    const plan = buildPromotionPlan({
      sourceKey: 'wikidata',
      externalId: 'Q123',
      claimsJson: {
        sourceTier: 'T1',
        brand: 'Example',
        model: 'Phone Lite',
        spec: { chipset: 'Example X1' },
      },
    });

    expect(plan.ok).toBe(false);
    expect(plan.issues.map((issue) => issue.code)).toContain('untrusted_promotion_source');
    expect(plan.issues.map((issue) => issue.code)).toContain('missing_spec_field');
  });

  it('accepts core-only specs and marks them for later enrichment', () => {
    const plan = buildPromotionPlan({
      sourceKey: 'mobileapi',
      externalId: 'core-only',
      sourceUrl: 'https://api.mobileapi.dev/devices/core-only/',
      claimsJson: {
        promotion: {
          sourceTier: 'T2',
          brand: 'Example',
          model: 'Phone Core',
          launchDate: '2026-01-05',
          status: 'active',
          spec: {
            display: { size_in: 6.1, resolution: '1179x2556' },
            chipset: 'Example X1',
            ramGb: 8,
            storageOptionsGb: [128],
            batteryMah: 3561,
          },
        },
      },
    });

    expect(plan.ok).toBe(true);
    expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'low_completeness' }));
    expect(plan.spec).toMatchObject({
      chipset: 'Example X1',
      battery_mah: 3561,
      charging: {},
      connectivity: {},
    });
    expect(plan.spec?.rear_cameras).toBeUndefined();
    expect(plan.spec?.os).toBeUndefined();
  });
});

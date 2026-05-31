/**
 * Unit tests for catalog validation gates.
 *
 * Tests cover: missing PhoneSpec fields, source-tier gating for upcoming
 * phones, and implausible numeric values.
 */
import { describe, expect, it } from 'vitest';

import { validateCatalogCandidate, validatePlausibility } from './validation';

describe('catalog validation', () => {
  it('blocks missing required identity/spec fields', () => {
    const issues = validateCatalogCandidate({
      brand: null,
      model: null,
      status: 'active',
      sourceTier: 'T0',
      spec: {},
    });
    expect(issues.some((i) => i.code === 'missing_brand')).toBe(true);
    expect(issues.some((i) => i.code === 'missing_spec_field')).toBe(true);
  });

  it('blocks upcoming phones from non-official/non-licensed tiers', () => {
    const issues = validateCatalogCandidate({
      brand: 'Example',
      model: 'Phone',
      status: 'upcoming',
      sourceTier: 'T3',
      spec: {},
    });
    expect(issues.some((i) => i.code === 'upcoming_untrusted_source')).toBe(true);
  });

  it('blocks future-dated candidates even when source labels them active', () => {
    const issues = validateCatalogCandidate({
      brand: 'Example',
      model: 'Phone Future',
      status: 'active',
      sourceTier: 'T2',
      launchDate: '2099-01-01',
      releasedAt: '2099-01-01',
      spec: {},
    });
    expect(issues.some((i) => i.code === 'unreleased_candidate')).toBe(true);
  });

  it('does not block missing enrichment-only fields', () => {
    const issues = validateCatalogCandidate({
      brand: 'Example',
      model: 'Phone Core',
      status: 'active',
      sourceTier: 'T2',
      spec: {
        display: { size_in: 6.1, resolution: '1179x2556' },
        chipset: 'Example X1',
        ramGb: 8,
        storageOptionsGb: [128],
        rearCameras: [{ type: 'main' as const, mp: 48 }],
        batteryMah: 3561,
        os: 'Android 16',
      },
    });
    expect(issues.some((i) => i.code === 'missing_spec_field')).toBe(false);
  });

  it('flags implausible values', () => {
    const issues = validatePlausibility({
      display: { size_in: 20, refresh_rate_hz: 120 },
      batteryMah: 50000,
      charging: { wired_w: 30, wireless_w: 0 },
    });
    expect(issues.some((i) => i.fieldPath === 'display.size_in')).toBe(true);
    expect(issues.some((i) => i.fieldPath === 'battery_mah')).toBe(true);
  });
});

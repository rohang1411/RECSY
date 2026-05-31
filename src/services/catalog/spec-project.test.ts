/**
 * Unit tests for catalog PhoneSpec projection.
 *
 * Tests cover: successful projection into the strict `PhoneSpecSchema` and
 * missing-field reporting for incomplete discovery-only sources.
 */
import { describe, expect, it } from 'vitest';

import { PhoneSpecSchema } from '@/features/phones/schema';

import {
  findMissingCoreFields,
  phoneSpecToCatalogProjectionInput,
  projectPhoneSpec,
  specCompleteness,
} from './spec-project';

const completeInput = {
  display: {
    size_in: 6.3,
    resolution: '2424x1080',
    refresh_rate_hz: 120,
    panel_type: 'OLED',
  },
  chipset: 'Tensor Test',
  ramGb: 8,
  storageOptionsGb: [128, 256],
  rearCameras: [{ type: 'main' as const, mp: 50, ois: true }],
  frontCamera: { mp: 12 },
  batteryMah: 5000,
  charging: { wired_w: 30, wireless_w: 15 },
  weightG: 190,
  os: 'Android',
  connectivity: { wifi: 'Wi-Fi 7', bluetooth: '5.3', nfc: true },
};

describe('projectPhoneSpec', () => {
  it('projects complete claims into a strict PhoneSpec', () => {
    const result = projectPhoneSpec(completeInput);
    expect(result.ok).toBe(true);
    expect(() => PhoneSpecSchema.parse(result.spec)).not.toThrow();
  });

  it('reports missing fields instead of inventing placeholders', () => {
    const result = projectPhoneSpec({ chipset: 'Unknown' });
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('display.size_in');
    expect(result.missing).toContain('battery_mah');
  });

  it('accepts core specs while leaving enrichment fields optional', () => {
    const result = projectPhoneSpec({
      display: { size_in: 6.1, resolution: '1179x2556' },
      chipset: 'Apple A18',
      ramGb: 8,
      storageOptionsGb: [128, 256],
      rearCameras: [{ type: 'main' as const, mp: 48 }],
      batteryMah: 3561,
      os: 'iOS 18',
    });

    expect(result.ok).toBe(true);
    expect(() => PhoneSpecSchema.parse(result.spec)).not.toThrow();
    expect(
      specCompleteness({
        display: { size_in: 6.1, resolution: '1179x2556' },
        chipset: 'Apple A18',
        ramGb: 8,
        storageOptionsGb: [128, 256],
        rearCameras: [{ type: 'main' as const, mp: 48 }],
        batteryMah: 3561,
        os: 'iOS 18',
      }),
    ).toBeLessThan(1);
  });

  it('reports only core gaps for promotion blocking', () => {
    const missing = findMissingCoreFields({
      display: { size_in: 6.1, resolution: '1179x2556' },
      chipset: 'Apple A18',
      ramGb: 8,
      storageOptionsGb: [128],
      rearCameras: [{ type: 'main' as const, mp: 48 }],
      batteryMah: 3561,
      os: 'iOS 18',
    });
    expect(missing).toEqual([]);
  });

  it('calculates completeness from required fields', () => {
    expect(specCompleteness(completeInput)).toBe(1);
    expect(specCompleteness({})).toBe(0);
  });

  it('round-trips an existing PhoneSpec through catalog projection input', () => {
    const projected = projectPhoneSpec(completeInput);
    expect(projected.ok).toBe(true);

    const roundTrip = projectPhoneSpec(phoneSpecToCatalogProjectionInput(projected.spec!));
    expect(roundTrip.ok).toBe(true);
    expect(roundTrip.spec).toEqual(PhoneSpecSchema.parse(projected.spec));
  });
});

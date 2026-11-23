import { describe, expect, it } from 'vitest';
import type { PhoneCatalogEntry } from './catalog';
import {
  classifyHardFeature,
  evaluatePhoneHardwareFeature,
  passesVerifiedHardFeatures,
  unsupportedHardFeatures,
} from './hard-features';
import type { UserRequirements } from './requirements-schema';

function makeEntry(specOverrides: Record<string, unknown> = {}): PhoneCatalogEntry {
  return {
    phoneId: 'phone-001',
    slug: 'pixel-9-pro',
    brand: 'Google',
    model: 'Pixel 9 Pro 5G',
    tagline: 'Google AI phone with 5G',
    msrpUsd: '999.00',
    imageUrl: null,
    aspectScores: new Map(),
    spec: {
      display: {
        size_in: 6.3,
        resolution: '1280x2856',
        refresh_rate_hz: 120,
        panel_type: 'OLED',
        features: ['LTPO'],
      },
      chipset: 'Google Tensor G4 (5G)',
      ram_gb: 16,
      storage_options_gb: [128, 256],
      rear_cameras: [
        { type: 'main', mp: 50 },
        { type: 'telephoto', mp: 48, zoom: '5x optical' },
      ],
      battery_mah: 4700,
      charging: { wired_w: 27, wireless_w: 21 },
      connectivity: { nfc: true, sim: 'Nano-SIM and eSIM' },
      ip_rating: 'IP68',
      colors: [],
      foldable: false,
      highlights: ['5G', 'esim', 'water resistant'],
      ...specOverrides,
    } as unknown as PhoneCatalogEntry['spec'],
    specEmbedding: null,
  };
}

function req(partial: Partial<UserRequirements>): UserRequirements {
  return {
    budget_usd: null,
    priorities: [],
    must_haves: [],
    deal_breakers: [],
    use_cases: [],
    brand_preference: { liked: [], disliked: [] },
    confidence: 1.0,
    ...partial,
  } as UserRequirements;
}

describe('Spec-Driven Hardware Verification Matrix (WP-02)', () => {
  it('classifies recognized hardware features correctly', () => {
    expect(classifyHardFeature('nfc')).toBe('nfc');
    expect(classifyHardFeature('contactless')).toBe('nfc');
    expect(classifyHardFeature('wireless charging')).toBe('wireless_charging');
    expect(classifyHardFeature('headphone jack')).toBe('headphone_jack');
    expect(classifyHardFeature('3.5mm')).toBe('headphone_jack');
    expect(classifyHardFeature('microsd')).toBe('microsd_slot');
    expect(classifyHardFeature('sd card')).toBe('microsd_slot');
    expect(classifyHardFeature('5G')).toBe('network_5g');
    expect(classifyHardFeature('waterproof')).toBe('water_resistance');
    expect(classifyHardFeature('ip68')).toBe('water_resistance');
    expect(classifyHardFeature('esim')).toBe('esim');
    expect(classifyHardFeature('telephoto')).toBe('telephoto_camera');
    expect(classifyHardFeature('optical zoom')).toBe('telephoto_camera');
    expect(classifyHardFeature('120Hz')).toBe('high_refresh_rate');
    expect(classifyHardFeature('compact')).toBe('compact_size');
    expect(classifyHardFeature('titanium frame')).toBe('unknown');
  });

  it('identifies unsupported hard features without treating deal breakers as unsupported', () => {
    const r = req({
      must_haves: ['NFC', 'titanium frame'],
      deal_breakers: ['curved screen', 'exynos'],
    });
    const unsupported = unsupportedHardFeatures(r);
    expect(unsupported).toEqual(['titanium frame']);
  });

  it('evaluates hardware features against catalog spec accurately', () => {
    const phone = makeEntry();
    expect(evaluatePhoneHardwareFeature(phone, 'nfc')).toBe(true);
    expect(evaluatePhoneHardwareFeature(phone, 'wireless_charging')).toBe(true);
    expect(evaluatePhoneHardwareFeature(phone, 'network_5g')).toBe(true);
    expect(evaluatePhoneHardwareFeature(phone, 'water_resistance')).toBe(true);
    expect(evaluatePhoneHardwareFeature(phone, 'esim')).toBe(true);
    expect(evaluatePhoneHardwareFeature(phone, 'telephoto_camera')).toBe(true);
    expect(evaluatePhoneHardwareFeature(phone, 'high_refresh_rate')).toBe(true);

    // Pixel 9 Pro is 6.3 inches, not compact (<= 6.2)
    expect(evaluatePhoneHardwareFeature(phone, 'compact_size')).toBe(false);

    // Pixel 9 Pro does not have headphone jack or microSD
    expect(evaluatePhoneHardwareFeature(phone, 'headphone_jack')).toBe(false);
    expect(evaluatePhoneHardwareFeature(phone, 'microsd_slot')).toBe(false);
  });

  it('passes verified hard features when all must-haves match', () => {
    const phone = makeEntry();
    expect(
      passesVerifiedHardFeatures(
        phone,
        req({ must_haves: ['NFC', 'wireless charging', '5G', 'IP68'] }),
      ),
    ).toBe(true);
  });

  it('fails verified hard features when must-have is missing or unsupported', () => {
    const phone = makeEntry();
    expect(passesVerifiedHardFeatures(phone, req({ must_haves: ['headphone jack'] }))).toBe(false);
    expect(passesVerifiedHardFeatures(phone, req({ must_haves: ['titanium frame'] }))).toBe(false);
  });

  it('does not reject catalog entries merely because deal_breakers are present', () => {
    const phone = makeEntry();
    expect(
      passesVerifiedHardFeatures(
        phone,
        req({ must_haves: ['NFC'], deal_breakers: ['bloatware', 'curved screen'] }),
      ),
    ).toBe(true);
  });
});

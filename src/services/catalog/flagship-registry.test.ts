import { describe, expect, it } from 'vitest';
import { CANONICAL_FLAGSHIPS } from './flagship-registry';
import { PhoneSpecSchema } from '@/features/phones/schema';

describe('flagship registry', () => {
  it('contains expected mainstream flagships from 2023-2026', () => {
    expect(CANONICAL_FLAGSHIPS.length).toBeGreaterThanOrEqual(23);
    const slugs = CANONICAL_FLAGSHIPS.map((f) => f.slug);
    expect(slugs).toContain('google-pixel-8');
    expect(slugs).toContain('google-pixel-8-pro');
    expect(slugs).toContain('google-pixel-8a');
    expect(slugs).toContain('google-pixel-9-pro-fold');
    expect(slugs).toContain('google-pixel-10');
    expect(slugs).toContain('google-pixel-10-pro');
    expect(slugs).toContain('google-pixel-10-pro-xl');
    expect(slugs).toContain('google-pixel-10-pro-fold');
    expect(slugs).toContain('google-pixel-11');
    expect(slugs).toContain('google-pixel-11-pro');
    expect(slugs).toContain('google-pixel-11-pro-xl');
    expect(slugs).toContain('google-pixel-11-pro-fold');
    expect(slugs).toContain('samsung-galaxy-s24');
    expect(slugs).toContain('samsung-galaxy-s24-ultra');
    expect(slugs).toContain('apple-iphone-15');
    expect(slugs).toContain('apple-iphone-15-pro-max');
    expect(slugs).toContain('oneplus-12');
    expect(slugs).toContain('nothing-phone-2');
  });

  it('validates all phone specs strictly against PhoneSpecSchema', () => {
    for (const flagship of CANONICAL_FLAGSHIPS) {
      const parsed = PhoneSpecSchema.safeParse(flagship.spec);
      expect(
        parsed.success,
        `PhoneSpec invalid for ${flagship.slug}: ${JSON.stringify(parsed)}`,
      ).toBe(true);
      expect(flagship.spec.battery_mah).toBeGreaterThan(3000);
      expect(flagship.spec.display.size_in).toBeGreaterThan(5.5);
      expect(flagship.spec.storage_options_gb.length).toBeGreaterThan(0);
      expect(flagship.aliases.length).toBeGreaterThan(0);
    }
  });

  it('has unique slugs and valid launch dates', () => {
    const seen = new Set<string>();
    for (const flagship of CANONICAL_FLAGSHIPS) {
      expect(seen.has(flagship.slug)).toBe(false);
      seen.add(flagship.slug);
      expect(Date.parse(flagship.launchDate)).not.toBeNaN();
    }
  });
});

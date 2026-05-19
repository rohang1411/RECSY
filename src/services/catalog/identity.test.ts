/**
 * Unit tests for catalog identity normalization.
 *
 * Tests cover: config-token stripping, conservative canonical key v1, slug
 * generation, and URL canonicalization.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCanonicalKey,
  buildPhoneSlug,
  canonicalizeUrl,
  normalizeIdentityText,
  stripConfigurationTokens,
} from './identity';

describe('catalog identity helpers', () => {
  it('normalizes trademark/punctuation noise', () => {
    expect(normalizeIdentityText('Galaxy S25 Ultra\u2122')).toBe('galaxy s25 ultra');
    expect(normalizeIdentityText('Pixel 9 Pro XL')).toBe('pixel 9 pro xl');
  });

  it('strips storage and color configuration tokens', () => {
    expect(stripConfigurationTokens('iPhone 16 Pro 256GB Black unlocked')).toBe('iphone 16 pro');
  });

  it('builds conservative canonical key v1', () => {
    expect(
      buildCanonicalKey({
        brand: 'Samsung',
        model: 'Galaxy S25 Ultra 512GB',
        launchDate: '2025-02-07',
      }),
    ).toBe('samsung:galaxy-s25-ultra:2025');
  });

  it('builds stable phone slugs from brand and model', () => {
    expect(buildPhoneSlug('Google', 'Pixel 9 Pro XL')).toBe('google-pixel-9-pro-xl');
  });

  it('canonicalizes URLs by removing tracking parameters', () => {
    expect(canonicalizeUrl('https://Example.com/phone/?utm_source=x&b=2&a=1#section')).toBe(
      'https://example.com/phone?a=1&b=2',
    );
  });
});

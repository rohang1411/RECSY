import { describe, expect, it } from 'vitest';

import { hasOemUrlBuilder, resolveOemUrls } from './oem-url-resolver';

describe('OEM URL resolver', () => {
  it('builds conservative Apple spec URLs', () => {
    expect(resolveOemUrls('Apple', 'iPhone 16 Pro')).toEqual([
      { brand: 'Apple', url: 'https://www.apple.com/iphone-16-pro/specs/' },
    ]);
  });

  it('builds conservative Google spec URLs', () => {
    expect(resolveOemUrls('Google', 'Pixel 9 Pro')).toEqual([
      { brand: 'Google', url: 'https://store.google.com/product/pixel_9_pro_specs' },
    ]);
  });

  it('builds conservative Samsung official URLs', () => {
    expect(resolveOemUrls('Samsung', 'Galaxy S25 Ultra')).toEqual([
      {
        brand: 'Samsung',
        url: 'https://www.samsung.com/latin_en/smartphones/galaxy-s25-ultra/specs/',
      },
      {
        brand: 'Samsung',
        url: 'https://www.samsung.com/us/smartphones/galaxy-s25-ultra/',
      },
    ]);
  });

  it('returns no URLs for unknown or unstable brands', () => {
    expect(hasOemUrlBuilder('Samsung')).toBe(true);
    expect(resolveOemUrls('Acer', 'Iconia X14')).toEqual([]);
  });
});

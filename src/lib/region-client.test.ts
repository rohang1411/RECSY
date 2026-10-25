// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import { readClientRegionCode, readClientRegion } from './region-client';

describe('readClientRegionCode', () => {
  beforeEach(() => {
    // Clear cookies
    document.cookie = 'recsy_region=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  });

  it('defaults to US when no cookie is set', () => {
    expect(readClientRegionCode()).toBe('US');
    expect(readClientRegion().countryCode).toBe('US');
  });

  it('reads IN when cookie is set to IN', () => {
    document.cookie = 'recsy_region=IN; path=/;';
    expect(readClientRegionCode()).toBe('IN');
    expect(readClientRegion().countryCode).toBe('IN');
    expect(readClientRegion().currency).toBe('INR');
  });

  it('handles lowercase cookie values gracefully', () => {
    document.cookie = 'recsy_region=in; path=/;';
    expect(readClientRegionCode()).toBe('IN');
  });

  it('falls back to US when cookie has an unsupported region code', () => {
    document.cookie = 'recsy_region=XX; path=/;';
    expect(readClientRegionCode()).toBe('US');
    expect(readClientRegion().countryCode).toBe('US');
  });

  it('correctly extracts cookie among multiple cookies', () => {
    document.cookie = 'other_cookie=123; path=/;';
    document.cookie = 'recsy_region=IN; path=/;';
    document.cookie = 'yet_another=abc; path=/;';
    expect(readClientRegionCode()).toBe('IN');
  });
});

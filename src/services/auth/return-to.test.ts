import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './return-to';

describe('safeReturnTo', () => {
  it('allows safe relative paths', () => {
    expect(safeReturnTo('/recommend')).toBe('/recommend');
    expect(safeReturnTo('/account/billing')).toBe('/account/billing');
    expect(safeReturnTo('/p/pixel-9-pro?tab=reviews')).toBe('/p/pixel-9-pro?tab=reviews');
    expect(safeReturnTo('/search?q=compact+flagship#results')).toBe(
      '/search?q=compact+flagship#results',
    );
  });

  it('falls back to "/" for empty, null, or undefined inputs', () => {
    expect(safeReturnTo(null)).toBe('/');
    expect(safeReturnTo(undefined)).toBe('/');
    expect(safeReturnTo('')).toBe('/');
    expect(safeReturnTo('   ')).toBe('/');
  });

  it('honors custom fallback when provided', () => {
    expect(safeReturnTo('', '/custom')).toBe('/custom');
    expect(safeReturnTo('https://evil.com', '/dashboard')).toBe('/dashboard');
  });

  it('rejects protocol-relative and scheme open redirects', () => {
    const malicious = [
      '//evil.com',
      '///evil.com',
      '//google.com/test',
      'https://evil.com',
      'http://attacker.com',
      'https:evil.com',
      'http:evil.com',
      '%2f%2fevil.com',
      '/%2f%2fevil.com',
      'javascript:alert(1)',
      'javascript:void(0)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      '/\\evil.com',
      '\\evil.com',
      '/\\\\evil.com',
      '/%2f/evil.com',
      '/%5c/evil.com',
      '/%00/evil.com',
      '/http://evil.com',
      '/https://evil.com',
      '//localhost:4000',
    ];

    for (const url of malicious) {
      expect(safeReturnTo(url)).toBe('/');
    }
  });

  it('rejects control characters, newlines, tabs, and carriage returns', () => {
    expect(safeReturnTo('/test\r\nHeader: Injection')).toBe('/');
    expect(safeReturnTo('/test\nSet-Cookie: evil')).toBe('/');
    expect(safeReturnTo('/test\tevil')).toBe('/');
    expect(safeReturnTo('/test\0nullbyte')).toBe('/');
    expect(safeReturnTo('/test%09evil')).toBe('/');
    expect(safeReturnTo('/test%0aevil')).toBe('/');
    expect(safeReturnTo('/test%0devil')).toBe('/');
  });
});

import { describe, expect, it } from 'vitest';
import { safeReturnTo } from '@/services/auth/return-to';

/**
 * Open Redirect Corpus Test Suite.
 * Normative reference: Plan 25 Section 10.3, Section 10.9.
 *
 * Exhaustively tests standard open-redirect attack vectors against `safeReturnTo`:
 * - Protocol-relative slashes
 * - Windows-style backslashes and mixed backslash sequences
 * - URL encoded slashes and bypasses
 * - Explicit scheme injections (http:, https:, javascript:, data:, etc.)
 * - Tab, newline, CR, null-byte tricks
 */
export const OPEN_REDIRECT_ATTACK_CORPUS = [
  // Protocol-relative
  '//evil.com',
  '///evil.com',
  '////evil.com',
  '//attacker.org/path',
  '//localhost:8000',

  // Backslash variations
  '/\\evil.com',
  '\\evil.com',
  '\\\\evil.com',
  '/\\\\evil.com',
  '/test\\evil.com',

  // URL encoded variations
  '%2f%2fevil.com',
  '/%2f%2fevil.com',
  '/%2f/evil.com',
  '/%5c/evil.com',
  '/%5c%5cevil.com',
  '/%00/evil.com',
  '/test%09evil.com',
  '/test%0aevil.com',
  '/test%0devil.com',

  // Schemes
  'https://evil.com',
  'http://evil.com',
  'https:evil.com',
  'http:evil.com',
  'ftp://evil.com',
  'javascript:alert(document.cookie)',
  'javascript:void(0)',
  'data:text/html,<script>window.location="http://evil.com"</script>',
  'vbscript:msgbox(1)',
  '/http://evil.com',
  '/https://evil.com',

  // Whitespace and control character injection
  '/path\r\nHeader-Injection: true',
  '/path\nSet-Cookie: session=hijacked',
  '/path\t/evil.com',
  '/path\0evil.com',
] as const;

describe('Open Redirect Security Corpus', () => {
  it.each(OPEN_REDIRECT_ATTACK_CORPUS)('neutralizes attack payload: %s', (payload) => {
    const result = safeReturnTo(payload, '/safe-fallback');
    expect(result).toBe('/safe-fallback');
  });

  it('permits strictly verified same-origin paths', () => {
    const validPaths = [
      '/',
      '/pricing',
      '/recommend',
      '/p/pixel-9-pro',
      '/account/billing',
      '/p/galaxy-s24-ultra?tab=specs#camera',
      '/search?q=oled+under+500&sort=price',
    ];

    for (const path of validPaths) {
      expect(safeReturnTo(path)).toBe(path);
    }
  });
});

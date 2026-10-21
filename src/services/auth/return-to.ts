/**
 * Validates and sanitizes a `returnTo` / `next` query parameter.
 * Open-redirect defence: strictly allows only relative same-origin paths starting with a single `/`.
 * Rejects protocol-relative URLs (`//evil.com`), backslashes, schemes, and control characters.
 */
export function safeReturnTo(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') {
    return fallback;
  }

  const trimmed = next.trim();
  if (!trimmed) {
    return fallback;
  }

  // Must start with exactly one '/' and not followed by another '/' or '\'
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  // Reject CRLF, tab, null bytes, backslashes, or control characters
  if (/[\r\n\t\0\\]/.test(trimmed)) {
    return fallback;
  }

  // Check URL encoded attempts like %2f, %5c
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded.startsWith('//') || decoded.startsWith('/\\') || /[\r\n\t\0\\]/.test(decoded)) {
      return fallback;
    }
  } catch {
    // Malformed URI encoding
    return fallback;
  }

  // Reject scheme-like payloads or protocol relative
  if (
    /^(?:[a-z0-9+.-]+:|\/\/)/i.test(trimmed) ||
    trimmed.startsWith('/http:') ||
    trimmed.startsWith('/https:')
  ) {
    return fallback;
  }

  return trimmed;
}

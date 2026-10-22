import { describe, expect, it } from 'vitest';
import { checkLegalPlaceholders } from '../../scripts/check-legal-placeholders';

describe('checkLegalPlaceholders', () => {
  it('detects existing placeholders in legal markdown content', () => {
    // In dev / non-strict, it returns success: true and reports the matches
    const result = checkLegalPlaceholders({
      strict: false,
      billingEnabled: false,
      isProduction: false,
    });

    expect(result.success).toBe(true);
    expect(result.matches.length).toBeGreaterThan(0);
    expect(result.matches.some((m) => m.file === 'terms.md')).toBe(true);
    expect(result.matches.some((m) => m.file === 'privacy.md')).toBe(true);
    expect(result.matches.some((m) => m.file === 'refunds.md')).toBe(true);
    expect(result.matches.some((m) => m.file === 'contact.md')).toBe(true);
  });

  it('fails build when strict=true and placeholders exist', () => {
    const result = checkLegalPlaceholders({
      strict: true,
      billingEnabled: false,
      isProduction: false,
    });

    expect(result.success).toBe(false);
  });

  it('fails build when billingEnabled=true in production and placeholders exist', () => {
    const result = checkLegalPlaceholders({
      strict: false,
      billingEnabled: true,
      isProduction: true,
    });

    expect(result.success).toBe(false);
  });

  it('permits placeholders in development even if billingEnabled=true', () => {
    const result = checkLegalPlaceholders({
      strict: false,
      billingEnabled: true,
      isProduction: false, // development / preview
    });

    expect(result.success).toBe(true);
  });
});

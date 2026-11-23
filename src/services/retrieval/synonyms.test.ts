import { describe, expect, it } from 'vitest';
import { SMARTPHONE_DOMAIN_SYNONYMS, expandSearchQuery } from './synonyms';

describe('Domain Synonym Expansion (WP-05)', () => {
  it('expands known technical acronyms into colloquial review phrases', () => {
    const expanded = expandSearchQuery('pwm');
    expect(expanded).toContain('flicker');
    expect(expanded).toContain('"eye strain"');
    expect(expanded).toContain('OR');
  });

  it('expands battery questions into endurance and screen-on-time synonyms', () => {
    const expanded = expandSearchQuery('battery life');
    expect(expanded).toContain('endurance');
    expect(expanded).toContain('"screen on time"');
  });

  it('leaves queries with no matching domain synonyms intact', () => {
    const raw = 'turquoise phone cover';
    expect(expandSearchQuery(raw)).toBe(raw);
  });

  it('handles empty or whitespace-only queries gracefully', () => {
    expect(expandSearchQuery('')).toBe('');
    expect(expandSearchQuery('   ')).toBe('   ');
  });

  it('exports verified domain dictionary', () => {
    expect(SMARTPHONE_DOMAIN_SYNONYMS.camera).toBeDefined();
    expect(SMARTPHONE_DOMAIN_SYNONYMS.charging).toBeDefined();
  });
});

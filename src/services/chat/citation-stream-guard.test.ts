import { describe, expect, it } from 'vitest';
import { CitationStreamGuard } from './citation-stream-guard';
import { validateCitationTags } from './citations';

describe('CitationStreamGuard', () => {
  const allowedId1 = '11111111-1111-1111-1111-111111111111';
  const allowedId2 = '22222222-2222-2222-2222-222222222222';
  const allowed = new Set([allowedId1, allowedId2]);

  it('emits plain text immediately', () => {
    const guard = new CitationStreamGuard(allowed);
    const { text, newlyCited } = guard.push('This is regular text without citations.');
    expect(text).toBe('This is regular text without citations.');
    expect(newlyCited).toEqual([]);
    expect(guard.stats).toEqual({ emittedTags: 0, strippedTags: 0 });
  });

  it('emits valid citation tags and tracks newlyCited chunk IDs', () => {
    const guard = new CitationStreamGuard(allowed);
    const input = `Battery lasts all day [c:${allowedId1}] with fast charging [c:${allowedId2}].`;
    const res = guard.push(input);
    const end = guard.flush();

    expect(res.text + end.text).toBe(input);
    expect(res.newlyCited).toEqual([allowedId1, allowedId2]);
    expect(guard.stats).toEqual({ emittedTags: 2, strippedTags: 0 });
    expect(guard.emitted).toBe(input);
  });

  it('only reports a chunk ID in newlyCited the first time it is cited', () => {
    const guard = new CitationStreamGuard(allowed);
    const res1 = guard.push(`Fact 1 [c:${allowedId1}] `);
    const res2 = guard.push(`Fact 2 [c:${allowedId1}] `);
    guard.flush();

    expect(res1.newlyCited).toEqual([allowedId1]);
    expect(res2.newlyCited).toEqual([]);
    expect(guard.stats).toEqual({ emittedTags: 2, strippedTags: 0 });
  });

  it('strips hallucinated citation tags and collapses doubled spaces', () => {
    const guard = new CitationStreamGuard(allowed);
    const hallucinatedId = '99999999-9999-9999-9999-999999999999';
    const input = `Fact A [c:${hallucinatedId}] and Fact B.`;
    const res = guard.push(input);
    const end = guard.flush();

    expect(res.text + end.text).toBe('Fact A and Fact B.');
    expect(res.newlyCited).toEqual([]);
    expect(guard.stats).toEqual({ emittedTags: 0, strippedTags: 1 });
  });

  it('handles tokens split across 1-character chunks', () => {
    const guard = new CitationStreamGuard(allowed);
    const fullText = `Camera is great [c:${allowedId1}].`;
    let output = '';
    const cited: string[] = [];

    for (const char of fullText) {
      const step = guard.push(char);
      output += step.text;
      cited.push(...step.newlyCited);
    }
    const end = guard.flush();
    output += end.text;

    expect(output).toBe(fullText);
    expect(cited).toEqual([allowedId1]);
    expect(guard.stats).toEqual({ emittedTags: 1, strippedTags: 0 });
  });

  it('passes through bracketed numbers [1] and words [see] as plain text', () => {
    const guard = new CitationStreamGuard(allowed);
    const input = 'Comparison [1] with previous model [see table].';
    const res = guard.push(input);
    const end = guard.flush();

    expect(res.text + end.text).toBe(input);
    expect(guard.stats).toEqual({ emittedTags: 0, strippedTags: 0 });
  });

  it('handles nested brackets correctly [[c:...]]', () => {
    const guard = new CitationStreamGuard(allowed);
    const input = `[[c:${allowedId1}]]`;
    const res = guard.push(input);
    const end = guard.flush();

    expect(res.text + end.text).toBe(`[[c:${allowedId1}]]`);
    expect(res.newlyCited).toEqual([allowedId1]);
    expect(guard.stats).toEqual({ emittedTags: 1, strippedTags: 0 });
  });

  it('supports case-insensitive tag prefix [C:<uuid>]', () => {
    const guard = new CitationStreamGuard(allowed);
    const input = `Fact [C:${allowedId1}] confirmed.`;
    const res = guard.push(input);
    const end = guard.flush();

    expect(res.text + end.text).toBe(input);
    expect(res.newlyCited).toEqual([allowedId1]);
    expect(guard.stats).toEqual({ emittedTags: 1, strippedTags: 0 });
  });

  it('handles 40 and 41 character boundary correctly', () => {
    const guard = new CitationStreamGuard(allowed);
    // 41 chars without closing bracket: cannot be tag, emits plain text
    const longNonTag = '[c:' + 'a'.repeat(38);
    const res = guard.push(longNonTag);
    const end = guard.flush();

    expect(res.text + end.text).toBe(longNonTag);
    expect(guard.stats.emittedTags).toBe(0);
  });

  it('drops pending partial citation tag starting with [c: at flush', () => {
    const guard = new CitationStreamGuard(allowed);
    guard.push('Answer ending abruptly [c:11111111');
    const _end = guard.flush();

    expect(guard.emitted).toBe('Answer ending abruptly ');
    expect(guard.stats.strippedTags).toBe(1);
  });

  it('property test: 1,000 random token stream splits preserve citation tag validity', () => {
    // Seeded deterministic PRNG for reproducibility
    let seed = 42;
    function random(): number {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    }

    const testAllowed = new Set([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
    const corpus = [
      'The display is bright [c:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa] and sharp.',
      'Battery lasts [c:bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb] but charging [c:cccccccc-cccc-cccc-cccc-cccccccccccc] is slow.',
      'Plain text without tags [1] or [see here] at all.',
      'Edge case [c:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa] at end',
    ];

    for (let run = 0; run < 1000; run++) {
      const template = corpus[run % corpus.length]!;
      const guard = new CitationStreamGuard(testAllowed);

      // Split template into random chunk sizes (1 to 5 chars)
      let offset = 0;
      while (offset < template.length) {
        const chunkSize = 1 + Math.floor(random() * 5);
        const chunk = template.slice(offset, offset + chunkSize);
        guard.push(chunk);
        offset += chunkSize;
      }
      guard.flush();

      // Invariant 1: guard.emitted must never contain an invalid citation tag
      const validation = validateCitationTags(guard.emitted, testAllowed);
      expect(validation.ok).toBe(true);

      // Invariant 2: if template had only valid tags, emitted matches template
      if (!template.includes('cccccccc')) {
        expect(guard.emitted).toBe(template);
      }
    }
  });
});

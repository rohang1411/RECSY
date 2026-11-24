import { describe, expect, it } from 'vitest';
import { verifyGeneratedAnswerEntailment, verifySentenceEntailment } from './nli-gate';

describe('Post-Generation NLI Entailment Gate (WP-06)', () => {
  const validChunkId = '11111111-1111-1111-1111-111111111111';
  const validChunkText =
    'The battery capacity is 5000 mAh and supports 65W fast charging, lasting over 14 hours in our battery tests.';

  it('classifies factually aligned sentence with matching numbers as ENTAILMENT', () => {
    const sentence = `The phone has a 5000 mAh battery with 65W charging [c:${validChunkId}].`;
    const res = verifySentenceEntailment(sentence, validChunkText);
    expect(res.classification).toBe('ENTAILMENT');
    expect(res.score).toBeGreaterThan(0.6);
  });

  it('classifies sentence with contradictory numbers as CONTRADICTION', () => {
    const sentence = `The phone supports 200W charging [c:${validChunkId}].`;
    const res = verifySentenceEntailment(sentence, validChunkText);
    expect(res.classification).toBe('CONTRADICTION');
    expect(res.reason).toContain('numerical_mismatch');
  });

  it('strips phantom citations and unentailed assertions from generated text', () => {
    const fakeChunkId = '99999999-9999-9999-9999-999999999999';
    const text = `The battery is 5000 mAh [c:${validChunkId}]. The camera has 100x zoom [c:${fakeChunkId}].`;

    const result = verifyGeneratedAnswerEntailment(text, [
      { chunkId: validChunkId, text: validChunkText },
    ]);

    expect(result.supportedClaims).toBe(1);
    expect(result.unsupportedClaims).toBe(1);
    expect(result.verifiedText).toContain(`[c:${validChunkId}]`);
    expect(result.verifiedText).not.toContain(`[c:${fakeChunkId}]`);
  });

  it('returns perfect entailment score when no citations are present', () => {
    const text = 'This phone is available in black, silver, and gold.';
    const result = verifyGeneratedAnswerEntailment(text, []);
    expect(result.entailmentScore).toBe(1.0);
    expect(result.unsupportedClaims).toBe(0);
  });
});

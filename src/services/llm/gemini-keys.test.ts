import { describe, expect, it } from 'vitest';
import { getConfiguredGeminiKeys } from './gemini-keys';

describe('Gemini key configuration', () => {
  it('accepts consecutive numbered slots five and six before an optional extra list', () => {
    const keys = getConfiguredGeminiKeys({
      GEMINI_API_KEY: 'primary',
      GEMINI_API_KEY_2: 'second',
      GEMINI_API_KEY_3: 'third',
      GEMINI_API_KEY_4: 'fourth',
      GEMINI_API_KEY_5: 'fifth',
      GEMINI_API_KEY_6: 'sixth',
      GEMINI_API_KEYS_EXTRA: 'seventh',
      GOOGLE_CLOUD_QUOTA_PROJECT_IDS: 'p1,p2,p3,p4,p5,p6,p7',
    });
    expect(keys.map((key) => key.apiKey)).toEqual([
      'primary',
      'second',
      'third',
      'fourth',
      'fifth',
      'sixth',
      'seventh',
    ]);
    expect(keys.map((key) => key.projectId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']);
  });

  it('keeps a missing numbered slot five from shifting slot six project attribution', () => {
    const keys = getConfiguredGeminiKeys({
      GEMINI_API_KEY: 'primary',
      GEMINI_API_KEY_6: 'sixth',
      GOOGLE_CLOUD_QUOTA_PROJECT_IDS: 'p1,,,,,p6',
    });
    expect(keys.map((key) => [key.name, key.projectId, key.apiKeyIndex])).toEqual([
      ['GEMINI_API_KEY', 'p1', 0],
      ['GEMINI_API_KEY_6', 'p6', 1],
    ]);
  });

  it('preserves existing key slots and accepts fifth and later keys', () => {
    const keys = getConfiguredGeminiKeys({
      GEMINI_API_KEY: 'primary',
      GEMINI_API_KEY_2: 'second',
      GEMINI_API_KEY_3: 'third',
      GEMINI_API_KEY_4: 'fourth',
      GEMINI_API_KEYS_EXTRA: ' fifth , sixth ',
      GOOGLE_CLOUD_QUOTA_PROJECT_IDS: 'p1,p2,p3,p4,p5,p6',
    });
    expect(keys.map((k) => k.apiKey)).toEqual([
      'primary',
      'second',
      'third',
      'fourth',
      'fifth',
      'sixth',
    ]);
    expect(keys.map((k) => k.projectId)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(keys.map((k) => k.apiKeyIndex)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('does not rotate through duplicate credentials or misassign their project mapping', () => {
    const keys = getConfiguredGeminiKeys({
      GEMINI_API_KEY: 'primary',
      GEMINI_API_KEY_2: 'primary',
      GEMINI_API_KEYS_EXTRA: 'primary,new,new',
      GOOGLE_CLOUD_QUOTA_PROJECT_IDS: 'p1,p1,,,p1,p2,p2',
    });
    expect(keys.map((k) => [k.apiKey, k.projectId, k.apiKeyIndex])).toEqual([
      ['primary', 'p1', 0],
      ['new', 'p2', 1],
    ]);
  });
  it('preserves project positions across missing legacy and extra slots', () => {
    const keys = getConfiguredGeminiKeys({
      GEMINI_API_KEY: 'primary',
      GEMINI_API_KEY_3: 'third',
      GEMINI_API_KEYS_EXTRA: ',sixth',
      GOOGLE_CLOUD_QUOTA_PROJECT_IDS: 'p1,,p3,,,p6',
    });
    expect(keys.map((k) => [k.projectId, k.apiKeyIndex])).toEqual([
      ['p1', 0],
      ['p3', 1],
      ['p6', 2],
    ]);
  });
  it('does not require quota project IDs to use API keys', () => {
    expect(getConfiguredGeminiKeys({ GEMINI_API_KEY: 'primary' })[0]?.projectId).toBeNull();
  });
});

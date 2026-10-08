import { beforeEach, describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({
  GEMINI_API_KEY: 'first',
  GEMINI_API_KEY_2: 'second',
  GEMINI_API_KEY_3: 'third',
  GEMINI_API_KEY_4: 'fourth',
  GEMINI_API_KEYS_EXTRA: 'fifth,sixth',
  GOOGLE_CLOUD_QUOTA_PROJECT_IDS: 'p1,p2,p3,p4,p5,p6',
}));
vi.mock('@/env', () => ({ env: config }));

import {
  getConfiguredGeminiKeyCount,
  getConfiguredGeminiQuotaProjects,
} from './google-gemini-quota';

describe('Gemini quota configuration', () => {
  beforeEach(() => {
    config.GEMINI_API_KEY_2 = 'second';
    config.GOOGLE_CLOUD_QUOTA_PROJECT_IDS = 'p1,p2,p3,p4,p5,p6';
  });

  it('monitors all six configured keys without exposing credential values', () => {
    expect(getConfiguredGeminiKeyCount()).toBe(6);
    expect(getConfiguredGeminiQuotaProjects()).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ projectId: `p${index + 1}`, apiKeyIndex: index })),
    );
  });

  it('keeps provider indices aligned when a slot is unused or lacks a project ID', () => {
    config.GEMINI_API_KEY_2 = '';
    config.GOOGLE_CLOUD_QUOTA_PROJECT_IDS = 'p1,,p3,,p5,p6';
    expect(getConfiguredGeminiKeyCount()).toBe(5);
    expect(getConfiguredGeminiQuotaProjects()).toEqual([
      { projectId: 'p1', apiKeyIndex: 0 },
      { projectId: 'p3', apiKeyIndex: 1 },
      { projectId: 'p5', apiKeyIndex: 3 },
      { projectId: 'p6', apiKeyIndex: 4 },
    ]);
  });
});

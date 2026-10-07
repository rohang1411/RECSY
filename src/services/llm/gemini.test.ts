import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createGoogle: vi.fn(() => ({})),
}));
vi.mock('@ai-sdk/google', () => ({ createGoogleGenerativeAI: mocks.createGoogle }));
vi.mock('@/env', () => ({
  env: {
    GEMINI_API_KEY: 'first',
    GEMINI_API_KEY_2: 'second',
    GEMINI_API_KEY_3: 'third',
    GEMINI_API_KEY_4: 'fourth',
    GEMINI_API_KEYS_EXTRA: 'fifth,sixth',
    GEMINI_RATE_LIMIT_PROFILE: 'off',
  },
}));
vi.mock('./usage', () => ({ recordLlmUsageEvent: vi.fn() }));

import { GeminiProvider } from './gemini';

describe('Gemini provider key pool', () => {
  beforeEach(() => mocks.createGoogle.mockClear());

  it('constructs clients for fifth and later credentials without making API requests', () => {
    new GeminiProvider();
    expect(mocks.createGoogle.mock.calls).toHaveLength(6);
    expect(mocks.createGoogle).toHaveBeenNthCalledWith(5, { apiKey: 'fifth' });
    expect(mocks.createGoogle).toHaveBeenNthCalledWith(6, { apiKey: 'sixth' });
  });

  it('preserves explicitly limited evaluation key budgets', () => {
    new GeminiProvider({ maxKeys: 1 });
    expect(mocks.createGoogle).toHaveBeenCalledExactlyOnceWith({ apiKey: 'first' });
  });
});

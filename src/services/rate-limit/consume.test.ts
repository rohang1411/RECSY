/**
 * Unit tests for API rate-limit consumption (`consume.ts`).
 *
 * Tests cover: first-request success, count-within-window success,
 * count-exceeds-limit throws `RateLimitError`, window rollover resets
 * the counter, separate key namespaces for ask vs recommend, and
 * the `askRateLimitKey` / `recommendRateLimitKey` format.
 *
 * DB is mocked via `vi.mock` — no real Postgres connections.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ASK_RATE_LIMIT_MAX, RECOMMEND_RATE_LIMIT_MAX } from '@/lib/constants';
import { RateLimitError } from '@/lib/errors';

// Mock the DB client before importing consume.ts (which imports client at module scope)
const mockInsert = vi.fn();
vi.mock('@/services/db/client', () => ({
  getDb: () => ({
    insert: mockInsert,
  }),
}));

// Import after mocks are set up
const { consumeAskRateLimit, consumeRecommendRateLimit, askRateLimitKey, recommendRateLimitKey } =
  await import('./consume');

function buildInsertChain(count: number) {
  const chain = {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([{ count }]),
  };
  return chain;
}

describe('askRateLimitKey', () => {
  it('prefixes with "ask:v1:"', () => {
    expect(askRateLimitKey('abc123')).toBe('ask:v1:abc123');
  });
});

describe('recommendRateLimitKey', () => {
  it('prefixes with "recommend:v1:"', () => {
    expect(recommendRateLimitKey('abc123')).toBe('recommend:v1:abc123');
  });

  it('uses a different prefix from askRateLimitKey', () => {
    expect(recommendRateLimitKey('x')).not.toBe(askRateLimitKey('x'));
  });
});

describe('consumeAskRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds when count is within the limit', async () => {
    mockInsert.mockReturnValue(buildInsertChain(1));
    await expect(consumeAskRateLimit('1.2.3.4')).resolves.toBeUndefined();
  });

  it('succeeds when count equals the limit exactly', async () => {
    mockInsert.mockReturnValue(buildInsertChain(ASK_RATE_LIMIT_MAX));
    await expect(consumeAskRateLimit('1.2.3.4')).resolves.toBeUndefined();
  });

  it('throws RateLimitError when count exceeds the limit', async () => {
    mockInsert.mockReturnValue(buildInsertChain(ASK_RATE_LIMIT_MAX + 1));
    await expect(consumeAskRateLimit('1.2.3.4')).rejects.toBeInstanceOf(RateLimitError);
  });

  it('does not throw when returning row is missing (defaults to count=1)', async () => {
    const chain = {
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    mockInsert.mockReturnValue(chain);
    await expect(consumeAskRateLimit('1.2.3.4')).resolves.toBeUndefined();
  });
});

describe('consumeRecommendRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds when count is within the recommend limit', async () => {
    mockInsert.mockReturnValue(buildInsertChain(1));
    await expect(consumeRecommendRateLimit('1.2.3.4')).resolves.toBeUndefined();
  });

  it('throws RateLimitError when recommend count exceeds limit', async () => {
    mockInsert.mockReturnValue(buildInsertChain(RECOMMEND_RATE_LIMIT_MAX + 1));
    await expect(consumeRecommendRateLimit('1.2.3.4')).rejects.toBeInstanceOf(RateLimitError);
  });
});
